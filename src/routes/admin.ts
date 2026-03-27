import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { getSupabase, loadSettings, saveSetting } from '../lib/supabase';
import { CloudCartClient } from '../lib/cloudcart';
import { CloudCartGqlClient } from '../lib/cloudcart-gql';
import { buildCustomerNote, pointsToEur, getTierForPoints, processHistoricalOrders, assignEligibleRewards } from '../lib/points';
import { generateCustomerToken } from './customer';

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ============================================================
// Settings
// ============================================================

admin.get('/settings', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const settings = await loadSettings(db, merchant.id);
  return c.json({ ...settings, store_name: merchant.store_name });
});

admin.patch('/settings', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const body = await c.req.json<Record<string, string>>();
  const allowed = [
    'points_per_eur', 'min_order_eur', 'trigger_status',
    'points_to_eur_rate', 'promo_code_prefix',
  ];
  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) await saveSetting(db, merchant.id, key, String(value));
  }
  if (body['store_name']) {
    await db.from('merchants')
      .update({ store_name: body['store_name'], updated_at: new Date().toISOString() })
      .eq('id', merchant.id);
  }
  const settings = await loadSettings(db, merchant.id);
  return c.json({ ...settings, store_name: body['store_name'] ?? merchant.store_name });
});

// ============================================================
// Change password (authenticated merchant)
// ============================================================

admin.patch('/password', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { current_password, new_password } = await c.req.json<{ current_password: string; new_password: string }>();

  if (!current_password || !new_password) {
    return c.json({ error: 'Both current_password and new_password required' }, 400);
  }
  if (new_password.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }

  const { data: match } = await db.rpc('verify_merchant_password', {
    merchant_slug: merchant.slug,
    plain_password: current_password,
  });

  if (!match) {
    const { data: hashMatch } = await db.rpc('check_password', {
      hashed: merchant.admin_password_hash ?? '',
      plain: current_password,
    });
    if (!hashMatch) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
  }

  const { data: newHash, error: hashErr } = await db.rpc('hash_password', { plain: new_password });
  if (hashErr || !newHash) {
    return c.json({ error: 'Password hashing failed' }, 500);
  }

  await db.from('merchants')
    .update({ admin_password_hash: newHash, updated_at: new Date().toISOString() })
    .eq('id', merchant.id);

  return c.json({ ok: true });
});

// ============================================================
// GraphQL PAT Token
// ============================================================

admin.get('/pat-status', async (c) => {
  const merchant = c.get('merchant');
  return c.json({ has_token: !!merchant.cloudcart_pat_token });
});

admin.patch('/pat-token', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { cloudcart_pat_token } = await c.req.json<{ cloudcart_pat_token: string }>();
  if (!cloudcart_pat_token) return c.json({ error: 'Token required' }, 400);

  await db.from('merchants')
    .update({ cloudcart_pat_token, updated_at: new Date().toISOString() })
    .eq('id', merchant.id);

  return c.json({ ok: true });
});

// ============================================================
// Tiers
// ============================================================

admin.get('/tiers', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('tiers')
    .select('*')
    .eq('merchant_id', merchant.id)
    .order('sort_order', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.post('/tiers', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('tiers')
    .insert({ ...body, merchant_id: merchant.id })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

admin.patch('/tiers/:id', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('tiers')
    .update(body)
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

admin.delete('/tiers/:id', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { error } = await db.from('tiers').delete()
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// ============================================================
// Reward types
// ============================================================

admin.get('/rewards', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('reward_types')
    .select('*')
    .eq('merchant_id', merchant.id)
    .order('sort_order', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.post('/rewards', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('reward_types')
    .insert({ ...body, merchant_id: merchant.id })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

admin.patch('/rewards/:id', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('reward_types')
    .update(body)
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

admin.delete('/rewards/:id', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { error } = await db.from('reward_types').delete()
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// ============================================================
// Bonus rules
// ============================================================

admin.get('/rules', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('bonus_rules')
    .select('*')
    .eq('merchant_id', merchant.id)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.post('/rules', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('bonus_rules')
    .insert({ ...body, merchant_id: merchant.id })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

admin.patch('/rules/:id', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('bonus_rules')
    .update(body)
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

admin.delete('/rules/:id', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { error } = await db.from('bonus_rules').delete()
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id);
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// ============================================================
// Customers
// ============================================================

admin.get('/customers', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const page = Number(c.req.query('page') ?? 1);
  const size = Number(c.req.query('size') ?? 20);
  const search = c.req.query('search') ?? '';

  const from = (page - 1) * size;
  const to = from + size - 1;

  let query = db
    .from('loyalty_customers')
    .select('*, tiers(id, name, min_points, sort_order)', { count: 'exact' })
    .eq('merchant_id', merchant.id)
    .order('points_balance', { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(
      `email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`,
    );
  }

  const { data, count, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data, total: count, page, size });
});

admin.get('/customers/:id', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .single();
  if (error) return c.json({ error: error.message }, 404);
  return c.json(data);
});

admin.post('/customers/:id/adjust', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const cc = CloudCartClient.forMerchant(merchant);
  const { points, description } = await c.req.json<{
    points: number;
    description?: string;
  }>();

  const { data: customer, error: fetchErr } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .single();

  if (fetchErr) return c.json({ error: 'Customer not found' }, 404);

  const newBalance = Math.max(0, customer.points_balance + points);
  const settings = await loadSettings(db, merchant.id);
  const { data: tiers } = await db.from('tiers').select('*').eq('merchant_id', merchant.id);
  const newTier = getTierForPoints(newBalance, tiers ?? []);

  await db
    .from('loyalty_customers')
    .update({
      points_balance: newBalance,
      tier_id: newTier?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customer.id);

  await db.from('points_transactions').insert({
    merchant_id: merchant.id,
    customer_id: customer.id,
    type: 'adjust',
    points,
    description: description ?? 'Manual adjustment by admin',
  });

  const promoValueEur = pointsToEur(newBalance, settings.points_to_eur_rate);
  const note = buildCustomerNote(newBalance, newTier, customer.promo_code, promoValueEur);
  const attrs: Record<string, unknown> = { note };
  if (newTier?.cloudcart_group_id) attrs['group_id'] = newTier.cloudcart_group_id;
  await cc.updateCustomer(customer.cloudcart_id, attrs as Parameters<typeof cc.updateCustomer>[1]);

  return c.json({ ok: true, new_balance: newBalance, tier: newTier?.name ?? null });
});

admin.post('/customers/:id/redeem', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const cc = CloudCartClient.forMerchant(merchant);
  const { points, description } = await c.req.json<{
    points: number;
    description?: string;
  }>();

  const { data: customer, error } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .single();
  if (error) return c.json({ error: 'Customer not found' }, 404);

  const newBalance = Math.max(0, customer.points_balance - points);
  const settings = await loadSettings(db, merchant.id);
  const { data: tiers } = await db.from('tiers').select('*').eq('merchant_id', merchant.id);
  const newTier = getTierForPoints(newBalance, tiers ?? []);

  await db
    .from('loyalty_customers')
    .update({
      points_balance: newBalance,
      tier_id: newTier?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customer.id);

  await db.from('points_transactions').insert({
    merchant_id: merchant.id,
    customer_id: customer.id,
    type: 'redeem',
    points: -Math.abs(points),
    description: description ?? 'Redemption',
  });

  const promoValueEur = pointsToEur(newBalance, settings.points_to_eur_rate);
  const note = buildCustomerNote(newBalance, newTier, customer.promo_code, promoValueEur);
  const attrs: Record<string, unknown> = { note };
  if (newTier?.cloudcart_group_id) attrs['group_id'] = newTier.cloudcart_group_id;
  await cc.updateCustomer(customer.cloudcart_id, attrs as Parameters<typeof cc.updateCustomer>[1]);

  return c.json({ ok: true, new_balance: newBalance, promo_value_eur: promoValueEur });
});

// ============================================================
// Transactions
// ============================================================

admin.get('/transactions', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const page = Number(c.req.query('page') ?? 1);
  const size = Number(c.req.query('size') ?? 30);
  const customerId = c.req.query('customer_id');

  const from = (page - 1) * size;
  const to = from + size - 1;

  let query = db
    .from('points_transactions')
    .select(
      '*, loyalty_customers(id, email, first_name, last_name, cloudcart_id)',
      { count: 'exact' },
    )
    .eq('merchant_id', merchant.id)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (customerId) query = query.eq('customer_id', customerId);

  const { data, count, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ data, total: count, page, size });
});

// ============================================================
// Stats overview
// ============================================================

admin.get('/stats', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);

  const [{ count: totalCustomers }, { data: pointsData }, { data: tierData }] =
    await Promise.all([
      db.from('loyalty_customers').select('*', { count: 'exact', head: true })
        .eq('merchant_id', merchant.id),
      db.from('loyalty_customers').select('points_balance')
        .eq('merchant_id', merchant.id),
      db.from('loyalty_customers').select('tiers(name)')
        .eq('merchant_id', merchant.id)
        .not('tier_id', 'is', null),
    ]);

  const totalPoints = (pointsData ?? []).reduce(
    (sum, r) => sum + (r.points_balance ?? 0),
    0,
  );

  const tierCounts: Record<string, number> = {};
  for (const row of tierData ?? []) {
    const r = row as unknown as { tiers: { name: string } | null };
    const name = r.tiers?.name ?? 'No tier';
    tierCounts[name] = (tierCounts[name] ?? 0) + 1;
  }

  const { count: totalTransactions } = await db
    .from('points_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('merchant_id', merchant.id);

  const { data: recentTx } = await db
    .from('points_transactions')
    .select('*, loyalty_customers(email, first_name, last_name)')
    .eq('merchant_id', merchant.id)
    .order('created_at', { ascending: false })
    .limit(10);

  return c.json({
    total_customers: totalCustomers ?? 0,
    total_points_outstanding: totalPoints,
    total_transactions: totalTransactions ?? 0,
    tier_distribution: tierCounts,
    recent_transactions: recentTx ?? [],
  });
});

// ============================================================
// Re-sync a single customer: pull orders from CloudCart → recalculate points
// ============================================================

admin.post('/customers/:id/sync', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const cc = CloudCartClient.forMerchant(merchant);
  let gql = CloudCartGqlClient.forMerchant(merchant);
  const settings = await loadSettings(db, merchant.id);

  const { data: customer, error } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .single();
  if (error) return c.json({ error: 'Not found' }, 404);

  const { data: tiers } = await db
    .from('tiers')
    .select('*')
    .eq('merchant_id', merchant.id)
    .order('sort_order', { ascending: true });
  const { data: bonusRules } = await db
    .from('bonus_rules')
    .select('*')
    .eq('merchant_id', merchant.id)
    .eq('active', true);
  const { data: rewardTypes } = await db
    .from('reward_types')
    .select('*')
    .eq('merchant_id', merchant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  let result;
  try {
    result = await processHistoricalOrders({
      db, cc, gql, merchant, settings,
      tiers: tiers ?? [],
      bonusRules: bonusRules ?? [],
      rewardTypes: rewardTypes ?? [],
      customer,
    });
  } catch (e) {
    // If GraphQL failed, retry with REST only
    if (gql) {
      gql = null;
      result = await processHistoricalOrders({
        db, cc, gql: null, merchant, settings,
        tiers: tiers ?? [],
        bonusRules: bonusRules ?? [],
        rewardTypes: rewardTypes ?? [],
        customer,
      });
    } else {
      return c.json({ error: e instanceof Error ? e.message : 'Sync failed' }, 500);
    }
  }

  const freshCustomer = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .single();

  const custForRewards = freshCustomer.data ?? customer;
  let rewardsIssued: string[] = [];
  try {
    const rw = await assignEligibleRewards({
      db, cc, gql, merchant,
      customer: custForRewards,
      rewardTypes: rewardTypes ?? [],
    });
    rewardsIssued = rw.issued;
  } catch { /* best-effort */ }

  return c.json({
    ok: true,
    orders_processed: result.ordersProcessed,
    points_awarded: result.pointsAwarded,
    new_balance: result.newBalance,
    rewards_issued: rewardsIssued,
    api: gql ? 'graphql' : 'rest',
  });
});

// ============================================================
// Generate customer widget token (for embed snippets)
// ============================================================

admin.get('/customers/:id/token', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { data: customer, error } = await db
    .from('loyalty_customers')
    .select('email')
    .eq('id', c.req.param('id'))
    .eq('merchant_id', merchant.id)
    .single();
  if (error) return c.json({ error: 'Not found' }, 404);

  const token = await generateCustomerToken(customer.email, merchant.webhook_secret);
  return c.json({ email: customer.email, token });
});

// ============================================================
// Customer rewards (issued vouchers)
// ============================================================

admin.get('/customers/:id/rewards', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('customer_rewards')
    .select('*, reward_types(id, name, discount_method, discount_target, discount_value)')
    .eq('merchant_id', merchant.id)
    .eq('customer_id', c.req.param('id'))
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.get('/rewards/issued', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('customer_rewards')
    .select('*, reward_types(id, name), loyalty_customers(id, email, first_name, last_name)')
    .eq('merchant_id', merchant.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Generate embed snippet for the merchant
admin.get('/embed-info', async (c) => {
  const merchant = c.get('merchant');
  const url = new URL(c.req.url);
  const origin = `${url.protocol}//${url.host}`;

  return c.json({
    slug: merchant.slug,
    loyalty_page_url: `${origin}/c/${merchant.slug}/page?email={CUSTOMER_EMAIL}&token={CUSTOMER_TOKEN}`,
    widget_url: `${origin}/c/${merchant.slug}/widget?email={CUSTOMER_EMAIL}&token={CUSTOMER_TOKEN}`,
    embed_script_url: `${origin}/c/${merchant.slug}/embed.js`,
    console_script: `${origin}/c/${merchant.slug}/console.js`,
    instructions: [
      '1. Generate a token for a customer via GET /api/m/:slug/admin/customers/:id/token',
      '2. Full page: redirect customer to the loyalty_page_url (replace placeholders)',
      '3. Embed widget: add <div id="loyalty-widget" data-email="X" data-token="Y"></div><script src="EMBED_SCRIPT_URL"></script>',
      '4. Console test: paste the console script URL contents into Chrome DevTools console on the store',
    ],
  });
});

export default admin;
