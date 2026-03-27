import { Hono } from 'hono';
import type { Env } from '../types';
import { getSupabase, getMerchantBySlug, loadSettings } from '../lib/supabase';
import { CloudCartClient } from '../lib/cloudcart';
import { CloudCartGqlClient } from '../lib/cloudcart-gql';
import { awardPoints } from '../lib/points';

const webhook = new Hono<{ Bindings: Env }>();

function extractOrder(payload: unknown): {
  orderId: number;
  orderStatus: string;
  customerId: number;
  priceTotal: number;
  customerEmail: string;
  firstName: string;
  lastName: string;
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  if (p['data'] && typeof p['data'] === 'object') {
    const d = p['data'] as Record<string, unknown>;
    if (d['type'] !== 'orders') return null;
    const attrs = (d['attributes'] ?? {}) as Record<string, unknown>;
    return {
      orderId: Number(d['id'] ?? 0),
      orderStatus: String(attrs['status'] ?? ''),
      customerId: Number(attrs['customer_id'] ?? 0),
      priceTotal: Number(attrs['price_total'] ?? 0),
      customerEmail: String(attrs['customer_email'] ?? ''),
      firstName: String(attrs['customer_first_name'] ?? ''),
      lastName: String(attrs['customer_last_name'] ?? ''),
    };
  }

  const flat = (p['order'] ?? p) as Record<string, unknown>;
  if (!flat['id']) return null;

  const priceRaw = Number(flat['price_total'] ?? flat['total'] ?? 0);
  const priceTotal = priceRaw > 0 && priceRaw < 100_000
    ? Math.round(priceRaw * 100)
    : priceRaw;

  return {
    orderId: Number(flat['id'] ?? 0),
    orderStatus: String(flat['status'] ?? flat['order_status'] ?? ''),
    customerId: Number(flat['customer_id'] ?? 0),
    priceTotal,
    customerEmail: String(flat['customer_email'] ?? ''),
    firstName: String(flat['customer_first_name'] ?? flat['first_name'] ?? ''),
    lastName: String(flat['customer_last_name'] ?? flat['last_name'] ?? ''),
  };
}

/**
 * POST /webhook/:slug/cloudcart
 * Each merchant gets a unique webhook URL based on their slug.
 */
webhook.post('/:slug/cloudcart', async (c) => {
  const db = getSupabase(c.env);
  const slug = c.req.param('slug');

  const merchant = await getMerchantBySlug(db, slug);
  if (!merchant) {
    return c.json({ error: 'Unknown merchant' }, 404);
  }

  const secret = c.req.header('X-Loyalty-Secret');
  if (!merchant.webhook_secret || secret !== merchant.webhook_secret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  c.executionCtx.waitUntil(
    (async () => {
      try {
        await db.from('webhook_logs').insert({
          merchant_id: merchant.id,
          raw_payload: payload,
          headers: {
            'x-loyalty-secret': secret ? '***' : null,
            'content-type': c.req.header('content-type'),
            'user-agent': c.req.header('user-agent'),
          },
        });
      } catch { /* best-effort */ }
    })(),
  );

  const order = extractOrder(payload);

  if (!order || !order.orderId || !order.customerId) {
    return c.json({ ok: true, skipped: 'not a recognisable order event' });
  }

  const orderEur = order.priceTotal / 100;
  const safetyCap = 500_000; // €500k — intentionally high to avoid blocking test orders
  if (orderEur > safetyCap) {
    console.error(`[${slug}] Suspiciously large order: €${orderEur} order #${order.orderId}`);
    return c.json({ ok: true, skipped: `order value €${orderEur} exceeds safety cap` });
  }

  const cc = CloudCartClient.forMerchant(merchant);
  const gql = CloudCartGqlClient.forMerchant(merchant);
  const settings = await loadSettings(db, merchant.id);

  if (order.orderStatus !== settings.trigger_status) {
    return c.json({
      ok: true,
      skipped: `status "${order.orderStatus}" ≠ trigger "${settings.trigger_status}"`,
    });
  }

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

  try {
    const { points, newBalance } = await awardPoints({
      db, cc, gql, merchant, settings,
      tiers: tiers ?? [],
      bonusRules: bonusRules ?? [],
      rewardTypes: rewardTypes ?? [],
      cloudcartOrderId: order.orderId,
      cloudcartCustomerId: order.customerId,
      orderValueCents: order.priceTotal,
      customerEmail: order.customerEmail,
      customerFirstName: order.firstName,
      customerLastName: order.lastName,
    });

    if (points === 0) {
      return c.json({ ok: true, skipped: 'already processed or zero points' });
    }

    return c.json({ ok: true, points_awarded: points, new_balance: newBalance });
  } catch (err) {
    console.error(`[${slug}] awardPoints error:`, err);
    return c.json({ error: String(err) }, 500);
  }
});

/**
 * GET /webhook/:slug/cloudcart/logs
 * Requires X-Loyalty-Secret header for authentication
 */
webhook.get('/:slug/cloudcart/logs', async (c) => {
  const db = getSupabase(c.env);
  const merchant = await getMerchantBySlug(db, c.req.param('slug'));
  if (!merchant) return c.json({ error: 'Unknown merchant' }, 404);

  const secret = c.req.header('X-Loyalty-Secret');
  if (!secret || secret !== merchant.webhook_secret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { data } = await db
    .from('webhook_logs')
    .select('id, merchant_id, headers, created_at')
    .eq('merchant_id', merchant.id)
    .order('created_at', { ascending: false })
    .limit(20);
  return c.json(data ?? []);
});

export default webhook;
