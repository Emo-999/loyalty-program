import { Hono } from 'hono';
import type { Env } from '../types';
import { getSupabase, loadSettings, saveSetting } from '../lib/supabase';
import { CloudCartClient } from '../lib/cloudcart';

const setup = new Hono<{ Bindings: Env }>();

/**
 * POST /api/setup
 *
 * One-time setup wizard:
 * 1. Creates CloudCart customer groups for each tier (if they don't have a cloudcart_group_id yet)
 * 2. Creates/updates the webhook on CloudCart pointing to this worker
 * 3. Returns a summary of what was done
 */
setup.post('/', async (c) => {
  const db = getSupabase(c.env);
  const cc = new CloudCartClient(c.env.CLOUDCART_API_KEY, c.env.CLOUDCART_BASE_URL);

  const log: string[] = [];
  const errors: string[] = [];

  // ---- 0. Create discount-codes-pro container (once) ----
  const settings = await loadSettings(db);
  if (settings.loyalty_container_id) {
    log.push(`Loyalty discount container already exists: #${settings.loyalty_container_id}`);
  } else {
    try {
      const container = await cc.createDiscountContainer('Loyalty Points');
      const containerId = Number(container.id);
      await saveSetting(db, 'loyalty_container_id', String(containerId));
      log.push(`Created loyalty discount container #${containerId}`);
    } catch (err) {
      errors.push(`Failed to create discount container: ${err}`);
    }
  }

  // ---- 1. Load tiers ----
  const { data: tiers, error: tiersErr } = await db
    .from('tiers')
    .select('*')
    .order('sort_order', { ascending: true });

  if (tiersErr) return c.json({ error: tiersErr.message }, 500);

  // ---- 2. Sync tier → CloudCart customer groups ----
  const existingGroups = await cc.listCustomerGroups();
  const existingByName = Object.fromEntries(
    existingGroups.map((g) => [g.attributes.name.toLowerCase(), Number(g.id)]),
  );

  for (const tier of tiers ?? []) {
    if (tier.cloudcart_group_id) {
      log.push(`Tier "${tier.name}" already linked to CloudCart group #${tier.cloudcart_group_id}`);
      continue;
    }

    const existing = existingByName[tier.name.toLowerCase()];
    if (existing) {
      await db
        .from('tiers')
        .update({ cloudcart_group_id: existing })
        .eq('id', tier.id);
      log.push(`Tier "${tier.name}" linked to existing CloudCart group #${existing}`);
    } else {
      try {
        const created = await cc.createCustomerGroup(tier.name);
        const ccGroupId = Number(created.id);
        await db
          .from('tiers')
          .update({ cloudcart_group_id: ccGroupId })
          .eq('id', tier.id);
        log.push(`Created CloudCart group "${tier.name}" → #${ccGroupId}`);
      } catch (err) {
        errors.push(`Failed to create group "${tier.name}": ${err}`);
      }
    }
  }

  // ---- 3. Register webhook on CloudCart ----
  // The worker URL is its own URL + /webhook/cloudcart
  const workerUrl = new URL(c.req.url);
  const webhookUrl = `${workerUrl.protocol}//${workerUrl.host}/webhook/cloudcart`;

  const existingWebhooks = await cc.listWebhooks();
  const alreadyRegistered = existingWebhooks.some(
    (w) => w.attributes.url === webhookUrl,
  );

  if (alreadyRegistered) {
    log.push(`Webhook already registered: ${webhookUrl}`);
  } else {
    try {
      // Create webhooks for both order.created and order.updated
      for (const event of ['order.created', 'order.updated']) {
        const alreadyHasEvent = existingWebhooks.some(
          (w) => w.attributes.url === webhookUrl && w.attributes.event === event,
        );
        if (alreadyHasEvent) {
          log.push(`Webhook for ${event} already exists`);
          continue;
        }
        await cc.createWebhook(webhookUrl, event, c.env.WEBHOOK_SECRET);
        log.push(`Created webhook: ${event} → ${webhookUrl}`);
      }
    } catch (err) {
      errors.push(`Failed to create webhook: ${err}`);
    }
  }

  // ---- 4. Persist webhook URL in settings for reference ----
  await saveSetting(db, 'webhook_url', webhookUrl);

  return c.json({
    ok: errors.length === 0,
    log,
    errors,
    next_steps: [
      'Run POST /api/setup/sync-existing to award points for historical orders',
      'Configure bonus rules via POST /api/admin/rules',
      'Adjust tier thresholds via PATCH /api/admin/tiers/:id',
    ],
  });
});

/**
 * POST /api/setup/sync-existing
 *
 * Imports all existing CloudCart customers into the loyalty DB.
 * Does NOT retroactively award points for old orders (use /backfill for that).
 * Safe to run multiple times (upsert by cloudcart_id).
 */
setup.post('/sync-existing', async (c) => {
  const db = getSupabase(c.env);
  const cc = new CloudCartClient(c.env.CLOUDCART_API_KEY, c.env.CLOUDCART_BASE_URL);

  let page = 1;
  let imported = 0;
  let skipped = 0;

  while (true) {
    const res = await cc.listCustomers(page, 50);
    const customers = res.data;
    if (!customers.length) break;

    for (const c of customers) {
      const { error } = await db.from('loyalty_customers').upsert(
        {
          cloudcart_id: Number(c.id),
          email: c.attributes.email,
          first_name: c.attributes.first_name,
          last_name: c.attributes.last_name,
        },
        { onConflict: 'cloudcart_id', ignoreDuplicates: true },
      );
      if (error) skipped++;
      else imported++;
    }

    if (page >= res.meta.page['last-page']) break;
    page++;
  }

  return c.json({ ok: true, imported, skipped });
});

export default setup;
