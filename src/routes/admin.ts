import { Hono } from 'hono';
import type { Env } from '../types';
import { getSupabase, loadSettings, saveSetting } from '../lib/supabase';
import { CloudCartClient } from '../lib/cloudcart';
import { awardPoints, buildCustomerNote, pointsToEur, getTierForPoints } from '../lib/points';

const admin = new Hono<{ Bindings: Env }>();

// ============================================================
// Settings
// ============================================================

admin.get('/settings', async (c) => {
  const db = getSupabase(c.env);
  const settings = await loadSettings(db);
  return c.json(settings);
});

admin.patch('/settings', async (c) => {
  const db = getSupabase(c.env);
  const body = await c.req.json<Record<string, string>>();
  const allowed = [
    'points_per_eur',
    'min_order_eur',
    'trigger_status',
    'points_to_eur_rate',
    'promo_code_prefix',
    'store_name',
  ];
  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) await saveSetting(db, key, String(value));
  }
  return c.json(await loadSettings(db));
});

// ============================================================
// Tiers
// ============================================================

admin.get('/tiers', async (c) => {
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('tiers')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.post('/tiers', async (c) => {
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('tiers')
    .insert(body)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

admin.patch('/tiers/:id', async (c) => {
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('tiers')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

admin.delete('/tiers/:id', async (c) => {
  const db = getSupabase(c.env);
  const { error } = await db.from('tiers').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// ============================================================
// Bonus rules
// ============================================================

admin.get('/rules', async (c) => {
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('bonus_rules')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

admin.post('/rules', async (c) => {
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('bonus_rules')
    .insert(body)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data, 201);
});

admin.patch('/rules/:id', async (c) => {
  const db = getSupabase(c.env);
  const body = await c.req.json();
  const { data, error } = await db
    .from('bonus_rules')
    .update(body)
    .eq('id', c.req.param('id'))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json(data);
});

admin.delete('/rules/:id', async (c) => {
  const db = getSupabase(c.env);
  const { error } = await db
    .from('bonus_rules')
    .delete()
    .eq('id', c.req.param('id'));
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ ok: true });
});

// ============================================================
// Customers
// ============================================================

admin.get('/customers', async (c) => {
  const db = getSupabase(c.env);
  const page = Number(c.req.query('page') ?? 1);
  const size = Number(c.req.query('size') ?? 20);
  const search = c.req.query('search') ?? '';

  const from = (page - 1) * size;
  const to = from + size - 1;

  let query = db
    .from('loyalty_customers')
    .select('*, tiers(id, name, min_points, sort_order)', { count: 'exact' })
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
  const db = getSupabase(c.env);
  const { data, error } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .single();
  if (error) return c.json({ error: error.message }, 404);
  return c.json(data);
});

// Manual points adjustment
admin.post('/customers/:id/adjust', async (c) => {
  const db = getSupabase(c.env);
  const cc = new CloudCartClient(c.env.CLOUDCART_API_KEY, c.env.CLOUDCART_BASE_URL);
  const { points, description } = await c.req.json<{
    points: number;
    description?: string;
  }>();

  const { data: customer, error: fetchErr } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .single();

  if (fetchErr) return c.json({ error: 'Customer not found' }, 404);

  const newBalance = Math.max(0, customer.points_balance + points);
  const settings = await loadSettings(db);
  const { data: tiers } = await db.from('tiers').select('*');
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
    customer_id: customer.id,
    type: 'adjust',
    points,
    description: description ?? `Manual adjustment by admin`,
  });

  // Sync to CloudCart
  const promoValueEur = pointsToEur(newBalance, settings.points_to_eur_rate);
  const note = buildCustomerNote(newBalance, newTier, customer.promo_code, promoValueEur);
  const attrs: Record<string, unknown> = { note };
  if (newTier?.cloudcart_group_id) attrs['group_id'] = newTier.cloudcart_group_id;
  await cc.updateCustomer(customer.cloudcart_id, attrs as Parameters<typeof cc.updateCustomer>[1]);

  if (customer.promo_code_cloudcart_id) {
    await cc.updateDiscountCode(customer.promo_code_cloudcart_id, promoValueEur);
  }

  return c.json({ ok: true, new_balance: newBalance, tier: newTier?.name ?? null });
});

// Redeem points (manually mark a redemption)
admin.post('/customers/:id/redeem', async (c) => {
  const db = getSupabase(c.env);
  const cc = new CloudCartClient(c.env.CLOUDCART_API_KEY, c.env.CLOUDCART_BASE_URL);
  const { points, description } = await c.req.json<{
    points: number;
    description?: string;
  }>();

  const { data: customer, error } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .single();
  if (error) return c.json({ error: 'Customer not found' }, 404);

  const newBalance = Math.max(0, customer.points_balance - points);
  const settings = await loadSettings(db);
  const { data: tiers } = await db.from('tiers').select('*');
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
    customer_id: customer.id,
    type: 'redeem',
    points: -Math.abs(points),
    description: description ?? `Redemption`,
  });

  // Sync promo code value
  const promoValueEur = pointsToEur(newBalance, settings.points_to_eur_rate);
  if (customer.promo_code_cloudcart_id) {
    await cc.updateDiscountCode(customer.promo_code_cloudcart_id, promoValueEur);
  }
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
  const db = getSupabase(c.env);
  const page = Number(c.req.query('page') ?? 1);
  const size = Number(c.req.query('size') ?? 30);
  const customerId = c.req.query('customer_id');

  const from = (page - 1) * size;
  const to = from + size - 1;

  let query = db
    .from('points_transactions')
    .select(
      `*, loyalty_customers(id, email, first_name, last_name, cloudcart_id)`,
      { count: 'exact' },
    )
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
  const db = getSupabase(c.env);

  const [{ count: totalCustomers }, { data: pointsData }, { data: tierData }] =
    await Promise.all([
      db.from('loyalty_customers').select('*', { count: 'exact', head: true }),
      db.from('loyalty_customers').select('points_balance'),
      db
        .from('loyalty_customers')
        .select('tiers(name)')
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
    .select('*', { count: 'exact', head: true });

  const { data: recentTx } = await db
    .from('points_transactions')
    .select(`*, loyalty_customers(email, first_name, last_name)`)
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
// Re-sync a single customer to CloudCart
// ============================================================

admin.post('/customers/:id/sync', async (c) => {
  const db = getSupabase(c.env);
  const cc = new CloudCartClient(c.env.CLOUDCART_API_KEY, c.env.CLOUDCART_BASE_URL);
  const settings = await loadSettings(db);

  const { data: customer, error } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('id', c.req.param('id'))
    .single();
  if (error) return c.json({ error: 'Not found' }, 404);

  const promoValueEur = pointsToEur(customer.points_balance, settings.points_to_eur_rate);
  const tier = customer.tiers ?? null;
  const note = buildCustomerNote(customer.points_balance, tier, customer.promo_code, promoValueEur);

  const attrs: Record<string, unknown> = { note };
  if (tier?.cloudcart_group_id) attrs['group_id'] = tier.cloudcart_group_id;
  await cc.updateCustomer(customer.cloudcart_id, attrs as Parameters<typeof cc.updateCustomer>[1]);

  if (customer.promo_code_cloudcart_id) {
    await cc.updateDiscountCode(customer.promo_code_cloudcart_id, promoValueEur);
  }

  return c.json({ ok: true });
});

export default admin;
