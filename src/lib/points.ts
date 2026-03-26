import type { SupabaseClient } from '@supabase/supabase-js';
import type { DbSettings, DbTier, DbBonusRule, DbCustomer } from '../types';
import { CloudCartClient } from './cloudcart';

// ============================================================
// Points calculation
// ============================================================

/** Calculate points earned for an order, applying all active bonus rules. */
export function calculatePointsForOrder(
  orderValueCents: number,
  settings: DbSettings,
  bonusRules: DbBonusRule[],
  orderProductIds: number[] = [],
): number {
  const orderEur = orderValueCents / 100;

  if (orderEur < settings.min_order_eur) return 0;

  // Base points
  let points = Math.floor(orderEur * settings.points_per_eur);

  const now = new Date();

  for (const rule of bonusRules) {
    if (!rule.active) continue;
    if (rule.valid_from && new Date(rule.valid_from) > now) continue;
    if (rule.valid_until && new Date(rule.valid_until) < now) continue;

    switch (rule.type) {
      case 'minimum_order': {
        const min = (rule.config['min_order_eur'] as number) ?? 0;
        if (orderEur >= min) points += rule.extra_points;
        break;
      }
      case 'product_ids': {
        const ids = (rule.config['product_ids'] as number[]) ?? [];
        const hasProduct = orderProductIds.some((id) => ids.includes(id));
        if (hasProduct) points += rule.extra_points;
        break;
      }
      case 'multiplier': {
        points = Math.floor(points * rule.multiplier);
        break;
      }
      case 'flat_bonus': {
        points += rule.extra_points;
        break;
      }
    }
  }

  return Math.max(0, points);
}

/** Convert points balance to EUR discount value (for promo code). */
export function pointsToEur(points: number, rate: number): number {
  return Math.floor(points / rate); // floor to whole EUR
}

/** Find the highest tier a customer qualifies for based on points. */
export function getTierForPoints(
  points: number,
  tiers: DbTier[],
): DbTier | null {
  const sorted = [...tiers].sort((a, b) => b.min_points - a.min_points);
  return sorted.find((t) => points >= t.min_points) ?? null;
}

/** Build the note string stored on the CloudCart customer profile. Visible in admin. */
export function buildCustomerNote(
  points: number,
  tier: DbTier | null,
  promoCode: string | null,
  promoValueEur: number,
): string {
  const tierLabel = tier ? tier.name : 'No tier yet';
  const codeLabel = promoCode ?? '—';
  return (
    `🎯 LOYALTY POINTS\n` +
    `Points: ${points.toLocaleString('en')}\n` +
    `Tier: ${tierLabel}\n` +
    `Promo code: ${codeLabel} (€${promoValueEur} discount)`
  );
}

// ============================================================
// Sync a single customer's loyalty state back to CloudCart
// ============================================================

export async function syncCustomerToCloudCart(
  cc: CloudCartClient,
  customer: DbCustomer & { tiers?: DbTier },
  settings: DbSettings,
): Promise<void> {
  const tier = customer.tiers ?? null;
  const promoValueEur = pointsToEur(customer.points_balance, settings.points_to_eur_rate);
  const note = buildCustomerNote(
    customer.points_balance,
    tier,
    customer.promo_code,
    promoValueEur,
  );

  // Update CloudCart customer: note + group_id (tier)
  const attrs: Partial<{ note: string; group_id: number }> = { note };
  if (tier?.cloudcart_group_id) attrs.group_id = tier.cloudcart_group_id;

  await cc.updateCustomer(customer.cloudcart_id, attrs);
}

// ============================================================
// Promo code management (discount-codes-pro)
// ============================================================

/**
 * Ensure the customer has a personal loyalty pro code on CloudCart.
 *
 * Uses the discount-codes-pro API:
 * - Creates a flat discount on all products equal to the points value
 * - only_customer: 1  → must be logged in (prevents code sharing)
 * - maxused_user: 1   → single use; the `uses` counter is our redemption detector
 *
 * On update: deletes the old code and creates a fresh one (resets the uses counter).
 * This is necessary because we can't reset `uses` via PATCH.
 */
export async function upsertPromoCode(
  cc: CloudCartClient,
  db: SupabaseClient,
  customer: DbCustomer,
  newValueCents: number,   // EUR cents (e.g. 1000 = €10)
  prefix: string,
  containerId: number,
): Promise<{ ccId: number; code: string }> {
  const expectedCode = `${prefix}${customer.cloudcart_id}`;

  // If we already have a CloudCart pro code ID, delete it and recreate
  // (we must recreate to reset the uses counter after a redemption)
  if (customer.promo_code_cloudcart_id) {
    try {
      await cc.deleteProCode(customer.promo_code_cloudcart_id);
    } catch {
      // Already gone — continue to create
    }
  }

  // Create fresh pro code with new value
  const created = await cc.createProCode({
    containerId,
    code: expectedCode,
    name: `Loyalty points — ${customer.email}`,
    valueCents: newValueCents,
  });
  const ccId = Number(created.id);

  await db
    .from('loyalty_customers')
    .update({
      promo_code: expectedCode,
      promo_code_cloudcart_id: ccId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customer.id);

  return { ccId, code: expectedCode };
}

/**
 * Check if a customer's loyalty pro code has been redeemed (uses > 0).
 * If so, record the redemption in Supabase and return the points deducted.
 */
export async function detectAndRecordRedemption(params: {
  cc: CloudCartClient;
  db: SupabaseClient;
  customer: DbCustomer;
  settings: DbSettings;
}): Promise<number> {
  const { cc, db, customer, settings } = params;

  if (!customer.promo_code_cloudcart_id) return 0;

  let proCode;
  try {
    proCode = await cc.getProCode(customer.promo_code_cloudcart_id);
  } catch {
    return 0; // code gone — nothing to detect
  }

  if (proCode.attributes.uses === 0) return 0;

  // Code was used — calculate how many points were redeemed
  // The redeemed value was the condition value at time of use (cents → EUR → points)
  const redeemedCents = proCode.attributes.conditions?.[0]?.value ?? 0;
  const redeemedEur = redeemedCents / 100;
  const pointsRedeemed = Math.round(redeemedEur * settings.points_to_eur_rate);

  // Record the redemption transaction
  await db.from('points_transactions').insert({
    customer_id: customer.id,
    type: 'redeem',
    points: -pointsRedeemed,
    description: `Promo code ${customer.promo_code} redeemed (€${redeemedEur.toFixed(2)})`,
  });

  return pointsRedeemed;
}

// ============================================================
// Award points after a qualifying order
// ============================================================

export async function awardPoints(params: {
  db: SupabaseClient;
  cc: CloudCartClient;
  settings: DbSettings;
  tiers: DbTier[];
  bonusRules: DbBonusRule[];
  cloudcartOrderId: number;
  cloudcartCustomerId: number;
  orderValueCents: number;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
}): Promise<{ points: number; newBalance: number }> {
  const {
    db,
    cc,
    settings,
    tiers,
    bonusRules,
    cloudcartOrderId,
    cloudcartCustomerId,
    orderValueCents,
    customerEmail,
    customerFirstName,
    customerLastName,
  } = params;

  // Idempotency check
  const { data: existing } = await db
    .from('processed_orders')
    .select('cloudcart_order_id')
    .eq('cloudcart_order_id', cloudcartOrderId)
    .maybeSingle();

  if (existing) {
    return { points: 0, newBalance: 0 };
  }

  // Upsert customer in our DB first (needed for redemption check)
  const { data: existingCustomer } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('cloudcart_id', cloudcartCustomerId)
    .maybeSingle();

  let customer: DbCustomer;
  if (existingCustomer) {
    customer = existingCustomer;
  } else {
    const { data: created, error } = await db
      .from('loyalty_customers')
      .insert({
        cloudcart_id: cloudcartCustomerId,
        email: customerEmail,
        first_name: customerFirstName,
        last_name: customerLastName,
        points_balance: 0,
      })
      .select('*, tiers(*)')
      .single();
    if (error) throw new Error(`Create customer: ${error.message}`);
    customer = created;
  }

  // ---- Redemption detection ----
  // Check if the customer's pro code was used since last update.
  // If uses > 0, they redeemed their points on a previous order.
  const pointsRedeemed = await detectAndRecordRedemption({ cc, db, customer, settings });
  const balanceAfterRedemption = Math.max(0, customer.points_balance - pointsRedeemed);

  // ---- Calculate points for this order ----
  const points = calculatePointsForOrder(orderValueCents, settings, bonusRules);
  const newBalance = balanceAfterRedemption + points;
  const newTier = getTierForPoints(newBalance, tiers);

  // Update customer balance + tier in Supabase
  const { error: updateErr } = await db
    .from('loyalty_customers')
    .update({
      points_balance: newBalance,
      tier_id: newTier?.id ?? null,
      email: customerEmail,
      first_name: customerFirstName,
      last_name: customerLastName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customer.id);
  if (updateErr) throw new Error(`Update customer: ${updateErr.message}`);

  if (points > 0) {
    await db.from('points_transactions').insert({
      customer_id: customer.id,
      cloudcart_order_id: cloudcartOrderId,
      type: 'earn',
      points,
      order_value_cents: orderValueCents,
      description: `Order #${cloudcartOrderId} — €${(orderValueCents / 100).toFixed(2)}`,
    });
  }

  await db.from('processed_orders').insert({
    cloudcart_order_id: cloudcartOrderId,
    customer_id: customer.id,
    points_awarded: points,
  });

  // ---- Sync promo code (pro) on CloudCart ----
  // Always recreate to reset the uses counter
  const promoValueCents = pointsToEur(newBalance, settings.points_to_eur_rate) * 100;
  const freshCustomer = {
    ...customer,
    points_balance: newBalance,
    tier_id: newTier?.id ?? null,
  };

  let code = customer.promo_code ?? `${settings.promo_code_prefix}${cloudcartCustomerId}`;

  if (settings.loyalty_container_id && promoValueCents > 0) {
    const { ccId, code: newCode } = await upsertPromoCode(
      cc,
      db,
      freshCustomer,
      promoValueCents,
      settings.promo_code_prefix,
      settings.loyalty_container_id,
    );
    code = newCode;
    // Update the freshCustomer reference for the note
    freshCustomer.promo_code_cloudcart_id = ccId;
  }

  // Update customer note + tier group on CloudCart
  const promoValueEur = pointsToEur(newBalance, settings.points_to_eur_rate);
  const note = buildCustomerNote(newBalance, newTier, code, promoValueEur);
  const ccAttrs: Partial<{ note: string; group_id: number }> = { note };
  if (newTier?.cloudcart_group_id) ccAttrs.group_id = newTier.cloudcart_group_id;
  await cc.updateCustomer(cloudcartCustomerId, ccAttrs);

  return { points, newBalance };
}
