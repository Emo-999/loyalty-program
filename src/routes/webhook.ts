import { Hono } from 'hono';
import type { Env } from '../types';
import { getSupabase, loadSettings } from '../lib/supabase';
import { CloudCartClient } from '../lib/cloudcart';
import { awardPoints } from '../lib/points';

const webhook = new Hono<{ Bindings: Env }>();

/**
 * Normalise a CloudCart webhook payload into a flat order object.
 *
 * CloudCart may send two different structures depending on version:
 *
 * New (JSON:API):
 *   { data: { type: "orders", id: "1", attributes: { status, price_total, ... } } }
 *
 * Old (flat):
 *   { id: 1, status: "paid", price_total: 12345, customer_id: 1, ... }
 *   OR wrapped: { order: { id: 1, status: "paid", ... } }
 */
function extractOrder(payload: unknown): {
  orderId: number;
  orderStatus: string;
  customerId: number;
  priceTotal: number;  // always in cents
  customerEmail: string;
  firstName: string;
  lastName: string;
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  // ---- JSON:API format ----
  if (p['data'] && typeof p['data'] === 'object') {
    const d = p['data'] as Record<string, unknown>;
    if (d['type'] !== 'orders') return null;
    const attrs = (d['attributes'] ?? {}) as Record<string, unknown>;
    const priceRaw = Number(attrs['price_total'] ?? 0);
    return {
      orderId: Number(d['id'] ?? 0),
      orderStatus: String(attrs['status'] ?? ''),
      customerId: Number(attrs['customer_id'] ?? 0),
      priceTotal: priceRaw,
      customerEmail: String(attrs['customer_email'] ?? ''),
      firstName: String(attrs['customer_first_name'] ?? ''),
      lastName: String(attrs['customer_last_name'] ?? ''),
    };
  }

  // ---- Flat / wrapped format ----
  const flat = (p['order'] ?? p) as Record<string, unknown>;
  if (!flat['id']) return null;

  // price_total in flat format might be in EUR (float) not cents — detect by size:
  // a realistic order total in EUR is < 100,000; in cents it would be < 10,000,000
  // if the raw value is a float or < 100,000 treat as EUR and convert to cents
  const priceRaw = Number(flat['price_total'] ?? flat['total'] ?? 0);
  const priceTotal = priceRaw > 0 && priceRaw < 100_000
    ? Math.round(priceRaw * 100)   // EUR → cents
    : priceRaw;                     // already cents

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
 * POST /webhook/cloudcart
 */
webhook.post('/cloudcart', async (c) => {
  // Validate shared secret
  const secret = c.req.header('X-Loyalty-Secret');
  if (c.env.WEBHOOK_SECRET && secret !== c.env.WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Log raw payload for debugging (best-effort, never block on failure)
  const db = getSupabase(c.env);
  c.executionCtx.waitUntil(
    (async () => {
      try {
        await db.from('webhook_logs').insert({
          raw_payload: payload,
          headers: {
            'x-loyalty-secret': c.req.header('X-Loyalty-Secret') ? '***' : null,
            'content-type': c.req.header('content-type'),
            'user-agent': c.req.header('user-agent'),
          },
        });
      } catch { /* best-effort */ }
    })(),
  );

  const order = extractOrder(payload);

  if (!order || !order.orderId || !order.customerId) {
    return c.json({ ok: true, skipped: 'not a recognisable order event', payload });
  }

  // Safety cap — ignore orders over €50,000 (likely bad data)
  const orderEur = order.priceTotal / 100;
  if (orderEur > 50_000) {
    console.error(`Suspiciously large order value: €${orderEur} on order #${order.orderId} — skipping`);
    return c.json({ ok: true, skipped: `order value €${orderEur} exceeds safety cap`, order_id: order.orderId });
  }

  const cc = new CloudCartClient(c.env.CLOUDCART_API_KEY, c.env.CLOUDCART_BASE_URL);
  const settings = await loadSettings(db);

  if (order.orderStatus !== settings.trigger_status) {
    return c.json({
      ok: true,
      skipped: `status "${order.orderStatus}" ≠ trigger "${settings.trigger_status}"`,
    });
  }

  const { data: tiers } = await db.from('tiers').select('*').order('sort_order', { ascending: true });
  const { data: bonusRules } = await db.from('bonus_rules').select('*').eq('active', true);

  try {
    const { points, newBalance } = await awardPoints({
      db,
      cc,
      settings,
      tiers: tiers ?? [],
      bonusRules: bonusRules ?? [],
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
    console.error('awardPoints error:', err);
    return c.json({ error: String(err) }, 500);
  }
});

/**
 * GET /webhook/cloudcart/logs  — inspect last 20 raw payloads (admin debug)
 */
webhook.get('/cloudcart/logs', async (c) => {
  const db = getSupabase(c.env);
  const { data } = await db
    .from('webhook_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  return c.json(data ?? []);
});

export default webhook;
