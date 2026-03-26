import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { getSupabase, loadSettings, saveSetting } from '../lib/supabase';
import { CloudCartClient } from '../lib/cloudcart';

const setup = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * POST /api/m/:slug/setup
 * Per-merchant one-time setup: creates discount container, customer groups, webhooks.
 */
setup.post('/', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const cc = CloudCartClient.forMerchant(merchant);

  const log: string[] = [];
  const errors: string[] = [];

  // 0. Create discount-codes-pro container
  if (merchant.loyalty_container_id) {
    log.push(`Loyalty discount container already exists: #${merchant.loyalty_container_id}`);
  } else {
    try {
      const container = await cc.createDiscountContainer('Loyalty Points');
      const containerId = Number(container.id);
      await db
        .from('merchants')
        .update({ loyalty_container_id: containerId, updated_at: new Date().toISOString() })
        .eq('id', merchant.id);
      merchant.loyalty_container_id = containerId;
      log.push(`Created loyalty discount container #${containerId}`);
    } catch (err) {
      errors.push(`Failed to create discount container: ${err}`);
    }
  }

  // 1. Sync tiers → CloudCart customer groups
  const { data: tiers, error: tiersErr } = await db
    .from('tiers')
    .select('*')
    .eq('merchant_id', merchant.id)
    .order('sort_order', { ascending: true });

  if (tiersErr) return c.json({ error: tiersErr.message }, 500);

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
      await db.from('tiers').update({ cloudcart_group_id: existing }).eq('id', tier.id);
      log.push(`Tier "${tier.name}" linked to existing CloudCart group #${existing}`);
    } else {
      try {
        const created = await cc.createCustomerGroup(tier.name);
        const ccGroupId = Number(created.id);
        await db.from('tiers').update({ cloudcart_group_id: ccGroupId }).eq('id', tier.id);
        log.push(`Created CloudCart group "${tier.name}" → #${ccGroupId}`);
      } catch (err) {
        errors.push(`Failed to create group "${tier.name}": ${err}`);
      }
    }
  }

  // 2. Register webhooks
  const workerUrl = new URL(c.req.url);
  const webhookUrl = `${workerUrl.protocol}//${workerUrl.host}/webhook/${merchant.slug}/cloudcart`;

  const existingWebhooks = await cc.listWebhooks();

  for (const event of ['order.created', 'order.updated']) {
    const alreadyHasEvent = existingWebhooks.some(
      (w) => w.attributes.url === webhookUrl && w.attributes.event === event,
    );
    if (alreadyHasEvent) {
      log.push(`Webhook for ${event} already exists`);
      continue;
    }
    try {
      await cc.createWebhook(webhookUrl, event, merchant.webhook_secret);
      log.push(`Created webhook: ${event} → ${webhookUrl}`);
    } catch (err) {
      errors.push(`Failed to create webhook for ${event}: ${err}`);
    }
  }

  await saveSetting(db, merchant.id, 'webhook_url', webhookUrl);

  return c.json({
    ok: errors.length === 0,
    log,
    errors,
    webhook_url: webhookUrl,
    next_steps: [
      'Run POST /api/m/:slug/setup/sync-existing to import existing customers',
      'Configure reward types and bonus rules via the admin dashboard',
    ],
  });
});

/**
 * POST /api/m/:slug/setup/sync-existing
 * Import all existing CloudCart customers into this merchant's loyalty DB.
 */
setup.post('/sync-existing', async (c) => {
  const merchant = c.get('merchant');
  const db = getSupabase(c.env);
  const cc = CloudCartClient.forMerchant(merchant);

  let page = 1;
  let imported = 0;
  let skipped = 0;

  while (true) {
    const res = await cc.listCustomers(page, 50);
    const customers = res.data;
    if (!customers.length) break;

    for (const cust of customers) {
      const { error } = await db.from('loyalty_customers').upsert(
        {
          merchant_id: merchant.id,
          cloudcart_id: Number(cust.id),
          email: cust.attributes.email,
          first_name: cust.attributes.first_name,
          last_name: cust.attributes.last_name,
        },
        { onConflict: 'merchant_id,cloudcart_id', ignoreDuplicates: true },
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
