import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DbSettings,
  DbTier,
  DbBonusRule,
  DbCustomer,
  DbMerchant,
  DbRewardType,
  CCProCondition,
} from '../types';
import { CloudCartClient } from './cloudcart';

// ============================================================
// Points calculation
// ============================================================

export function calculatePointsForOrder(
  orderValueCents: number,
  settings: DbSettings,
  bonusRules: DbBonusRule[],
  orderProductIds: number[] = [],
): number {
  const orderEur = orderValueCents / 100;

  if (orderEur < settings.min_order_eur) return 0;

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

export function pointsToEur(points: number, rate: number): number {
  return Math.floor(points / rate);
}

export function getTierForPoints(
  points: number,
  tiers: DbTier[],
): DbTier | null {
  const sorted = [...tiers].sort((a, b) => b.min_points - a.min_points);
  return sorted.find((t) => points >= t.min_points) ?? null;
}

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
// Build CloudCart pro-code conditions from a reward type
// ============================================================

export function buildConditionsForReward(
  reward: DbRewardType,
  valueCentsOverride?: number,
): CCProCondition[] {
  const value = valueCentsOverride ?? reward.discount_value;
  const condition: CCProCondition = {
    type: reward.discount_method,
    setting: reward.discount_target,
    value,
  };

  if (reward.discount_target === 'order_over' && reward.order_over_cents) {
    condition.order_over = reward.order_over_cents;
  }
  if (reward.discount_target === 'product' && reward.product_ids?.length) {
    condition.product = reward.product_ids;
  }
  if (reward.discount_target === 'category' && reward.category_ids?.length) {
    condition.category = reward.category_ids;
  }
  if (reward.discount_target === 'vendor' && reward.vendor_ids?.length) {
    condition.vendor = reward.vendor_ids;
  }

  return [condition];
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

  const attrs: Partial<{ note: string; group_id: number }> = { note };
  if (tier?.cloudcart_group_id) attrs.group_id = tier.cloudcart_group_id;

  await cc.updateCustomer(customer.cloudcart_id, attrs);
}

// ============================================================
// Promo code management (discount-codes-pro)
// ============================================================

export async function upsertPromoCode(
  cc: CloudCartClient,
  db: SupabaseClient,
  customer: DbCustomer,
  valueCents: number,
  prefix: string,
  containerId: number,
  rewardTypes: DbRewardType[],
): Promise<{ ccId: number; code: string }> {
  const expectedCode = `${prefix}${customer.cloudcart_id}`;

  if (customer.promo_code_cloudcart_id) {
    try {
      await cc.deleteProCode(customer.promo_code_cloudcart_id);
    } catch {
      // Already gone
    }
  }

  const autoReward = rewardTypes.find((r) => r.auto_apply && r.active);
  let conditions: CCProCondition[];
  if (autoReward) {
    conditions = buildConditionsForReward(autoReward, valueCents);
  } else {
    conditions = [{ type: 'flat', setting: 'all', value: valueCents }];
  }

  const created = await cc.createProCode({
    containerId,
    code: expectedCode,
    name: `Loyalty points — ${customer.email}`,
    conditions,
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

export async function detectAndRecordRedemption(params: {
  cc: CloudCartClient;
  db: SupabaseClient;
  customer: DbCustomer;
  settings: DbSettings;
  merchantId: string;
}): Promise<number> {
  const { cc, db, customer, settings, merchantId } = params;

  if (!customer.promo_code_cloudcart_id) return 0;

  let proCode;
  try {
    proCode = await cc.getProCode(customer.promo_code_cloudcart_id);
  } catch {
    return 0;
  }

  if (proCode.attributes.uses === 0) return 0;

  const redeemedCents = proCode.attributes.conditions?.[0]?.value ?? 0;
  const redeemedEur = redeemedCents / 100;
  const pointsRedeemed = Math.round(redeemedEur * settings.points_to_eur_rate);

  await db.from('points_transactions').insert({
    merchant_id: merchantId,
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
  merchant: DbMerchant;
  settings: DbSettings;
  tiers: DbTier[];
  bonusRules: DbBonusRule[];
  rewardTypes: DbRewardType[];
  cloudcartOrderId: number;
  cloudcartCustomerId: number;
  orderValueCents: number;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
}): Promise<{ points: number; newBalance: number }> {
  const {
    db, cc, merchant, settings, tiers, bonusRules, rewardTypes,
    cloudcartOrderId, cloudcartCustomerId, orderValueCents,
    customerEmail, customerFirstName, customerLastName,
  } = params;

  const merchantId = merchant.id;

  // Idempotency check
  const { data: existing } = await db
    .from('processed_orders')
    .select('cloudcart_order_id')
    .eq('merchant_id', merchantId)
    .eq('cloudcart_order_id', cloudcartOrderId)
    .maybeSingle();

  if (existing) {
    return { points: 0, newBalance: 0 };
  }

  // Upsert customer
  const { data: existingCustomer } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('merchant_id', merchantId)
    .eq('cloudcart_id', cloudcartCustomerId)
    .maybeSingle();

  let customer: DbCustomer;
  if (existingCustomer) {
    customer = existingCustomer;
  } else {
    const { data: created, error } = await db
      .from('loyalty_customers')
      .insert({
        merchant_id: merchantId,
        cloudcart_id: cloudcartCustomerId,
        email: customerEmail,
        first_name: customerFirstName,
        last_name: customerLastName,
        points_balance: 0,
        lifetime_points: 0,
      })
      .select('*, tiers(*)')
      .single();
    if (error) throw new Error(`Create customer: ${error.message}`);
    customer = created;
  }

  // Redemption detection
  const pointsRedeemed = await detectAndRecordRedemption({
    cc, db, customer, settings, merchantId,
  });
  const balanceAfterRedemption = Math.max(0, customer.points_balance - pointsRedeemed);

  // Calculate points for this order
  const points = calculatePointsForOrder(orderValueCents, settings, bonusRules);
  const newBalance = balanceAfterRedemption + points;
  const newLifetime = (customer.lifetime_points ?? 0) + points;
  const newTier = getTierForPoints(newBalance, tiers);

  const { error: updateErr } = await db
    .from('loyalty_customers')
    .update({
      points_balance: newBalance,
      lifetime_points: newLifetime,
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
      merchant_id: merchantId,
      customer_id: customer.id,
      cloudcart_order_id: cloudcartOrderId,
      type: 'earn',
      points,
      order_value_cents: orderValueCents,
      description: `Order #${cloudcartOrderId} — €${(orderValueCents / 100).toFixed(2)}`,
    });
  }

  await db.from('processed_orders').insert({
    merchant_id: merchantId,
    cloudcart_order_id: cloudcartOrderId,
    customer_id: customer.id,
    points_awarded: points,
  });

  // Sync promo code on CloudCart
  const promoValueCents = pointsToEur(newBalance, settings.points_to_eur_rate) * 100;
  const freshCustomer = {
    ...customer,
    points_balance: newBalance,
    lifetime_points: newLifetime,
    tier_id: newTier?.id ?? null,
  };

  let code = customer.promo_code ?? `${settings.promo_code_prefix}${cloudcartCustomerId}`;

  if (merchant.loyalty_container_id && promoValueCents > 0) {
    const { ccId, code: newCode } = await upsertPromoCode(
      cc, db, freshCustomer, promoValueCents,
      settings.promo_code_prefix, merchant.loyalty_container_id, rewardTypes,
    );
    code = newCode;
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
