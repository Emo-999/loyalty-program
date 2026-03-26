import { Hono } from 'hono';
import type { Env } from '../types';
import { getSupabase, getMerchantBySlug, loadSettings } from '../lib/supabase';
import { pointsToEur, getTierForPoints } from '../lib/points';
import { customerPageHtml, widgetHtml } from '../ui/customer';

const customer = new Hono<{ Bindings: Env }>();

/**
 * HMAC-based customer token: SHA-256(email + ":" + webhook_secret)
 * Merchants generate these for each customer, or we auto-generate in embed snippets.
 * This prevents random people from looking up other customers' points.
 */
async function verifyCustomerToken(
  email: string,
  token: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(email.toLowerCase()));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return expected === token.toLowerCase();
}

export async function generateCustomerToken(
  email: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(email.toLowerCase()));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * GET /c/:slug/api/me?email=X&token=Y
 * Public customer API — returns the customer's loyalty data.
 */
customer.get('/:slug/api/me', async (c) => {
  const db = getSupabase(c.env);
  const slug = c.req.param('slug');
  const email = c.req.query('email');
  const token = c.req.query('token');

  if (!email || !token) {
    return c.json({ error: 'email and token required' }, 400);
  }

  const merchant = await getMerchantBySlug(db, slug);
  if (!merchant) return c.json({ error: 'Unknown store' }, 404);

  const valid = await verifyCustomerToken(email, token, merchant.webhook_secret);
  if (!valid) return c.json({ error: 'Invalid token' }, 401);

  const settings = await loadSettings(db, merchant.id);

  const { data: customerData } = await db
    .from('loyalty_customers')
    .select('*, tiers(*)')
    .eq('merchant_id', merchant.id)
    .ilike('email', email.toLowerCase())
    .maybeSingle();

  const { data: allTiers } = await db
    .from('tiers')
    .select('*')
    .eq('merchant_id', merchant.id)
    .order('sort_order', { ascending: true });

  const { data: rewardTypes } = await db
    .from('reward_types')
    .select('*')
    .eq('merchant_id', merchant.id)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  const { data: recentTx } = await db
    .from('points_transactions')
    .select('*')
    .eq('merchant_id', merchant.id)
    .eq('customer_id', customerData?.id ?? '00000000-0000-0000-0000-000000000000')
    .order('created_at', { ascending: false })
    .limit(10);

  const points = customerData?.points_balance ?? 0;
  const lifetime = customerData?.lifetime_points ?? 0;
  const currentTier = customerData?.tiers ?? null;

  const sortedTiers = [...(allTiers ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const nextTier = sortedTiers.find((t) => t.min_points > points) ?? null;
  const pointsToNext = nextTier ? nextTier.min_points - points : 0;

  const promoValueEur = pointsToEur(points, settings.points_to_eur_rate);

  return c.json({
    store_name: merchant.store_name,
    customer: customerData
      ? {
          first_name: customerData.first_name,
          email: customerData.email,
          points_balance: points,
          lifetime_points: lifetime,
          promo_code: customerData.promo_code,
          promo_value_eur: promoValueEur,
        }
      : null,
    current_tier: currentTier
      ? { name: currentTier.name, min_points: currentTier.min_points }
      : null,
    next_tier: nextTier
      ? { name: nextTier.name, min_points: nextTier.min_points, points_needed: pointsToNext }
      : null,
    tiers: sortedTiers.map((t) => ({
      name: t.name,
      min_points: t.min_points,
      reached: points >= t.min_points,
    })),
    rewards: (rewardTypes ?? []).map((r) => ({
      name: r.name,
      description: r.description,
      discount_method: r.discount_method,
      min_points_cost: r.min_points_cost,
      available: points >= r.min_points_cost,
    })),
    recent_activity: (recentTx ?? []).map((tx) => ({
      type: tx.type,
      points: tx.points,
      description: tx.description,
      date: tx.created_at,
    })),
    settings: {
      points_per_eur: settings.points_per_eur,
      points_to_eur_rate: settings.points_to_eur_rate,
    },
  });
});

/**
 * GET /c/:slug/page?email=X&token=Y
 * Full-page loyalty view (standalone, can be linked from CloudCart)
 */
customer.get('/:slug/page', async (c) => {
  return c.html(customerPageHtml);
});

/**
 * GET /c/:slug/widget?email=X&token=Y
 * Compact widget view (for iframe embedding in CloudCart)
 */
customer.get('/:slug/widget', async (c) => {
  return c.html(widgetHtml);
});

/**
 * GET /c/:slug/embed.js
 * JavaScript snippet that CloudCart merchants include in their store.
 * Auto-creates an iframe pointing to the widget.
 */
customer.get('/:slug/embed.js', async (c) => {
  const slug = c.req.param('slug');
  const origin = `${new URL(c.req.url).origin}`;

  const js = `
(function() {
  var container = document.getElementById('loyalty-widget');
  if (!container) { container = document.createElement('div'); container.id = 'loyalty-widget'; document.currentScript.parentNode.appendChild(container); }
  var email = container.getAttribute('data-email') || '';
  var token = container.getAttribute('data-token') || '';
  if (!email || !token) { container.innerHTML = '<p style="color:#999;font-size:14px;">Loyalty widget: missing data-email / data-token</p>'; return; }
  var iframe = document.createElement('iframe');
  iframe.src = '${origin}/c/${slug}/widget?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token);
  iframe.style.width = '100%';
  iframe.style.minHeight = '600px';
  iframe.style.border = 'none';
  iframe.style.borderRadius = '16px';
  iframe.setAttribute('loading', 'lazy');
  container.appendChild(iframe);
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'loyalty-resize') { iframe.style.height = e.data.height + 'px'; }
  });
})();
`;

  return c.text(js, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
});

/**
 * GET /c/:slug/console.js?email=X&token=Y
 * Standalone script you paste into Chrome console on any page.
 * Creates a full BestSecret-style loyalty overlay.
 */
customer.get('/:slug/console.js', async (c) => {
  const slug = c.req.param('slug');
  const origin = `${new URL(c.req.url).origin}`;

  const js = `
(function(){
  var SLUG = '${slug}';
  var API = '${origin}/c/${slug}/api/me';
  var email = new URLSearchParams(window.location.search).get('loyalty_email') || prompt('Enter customer email:');
  if (!email) return;
  var token = new URLSearchParams(window.location.search).get('loyalty_token') || prompt('Enter loyalty token (get from admin API):');
  if (!token) return;

  fetch(API + '?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token))
    .then(function(r) { return r.json() })
    .then(function(d) { if (d.error) throw new Error(d.error); renderOverlay(d) })
    .catch(function(e) { alert('Loyalty error: ' + e.message) });

  function renderOverlay(d) {
    if (document.getElementById('lp-overlay')) document.getElementById('lp-overlay').remove();

    var overlay = document.createElement('div');
    overlay.id = 'lp-overlay';
    overlay.innerHTML = buildHTML(d);
    document.body.appendChild(overlay);

    var style = document.createElement('style');
    style.textContent = \`
      #lp-overlay { position:fixed; top:0; right:0; width:420px; height:100vh; z-index:999999;
        background:#FAFAFA; box-shadow:-4px 0 24px rgba(0,0,0,.15); overflow-y:auto;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; font-size:14px; color:#1E1E2F; line-height:1.5; }
      #lp-overlay * { box-sizing:border-box; margin:0; padding:0; }
      #lp-overlay .lp-close { position:absolute; top:12px; right:16px; background:rgba(255,255,255,.2); border:none;
        color:#fff; font-size:20px; cursor:pointer; width:32px; height:32px; border-radius:50%;
        display:flex; align-items:center; justify-content:center; z-index:2; }
      #lp-overlay .lp-close:hover { background:rgba(255,255,255,.3); }
      #lp-overlay .lp-hero { text-align:center; padding:40px 20px 28px; background:linear-gradient(135deg,#1E1E2F 0%,#312E81 100%); color:#fff; position:relative; }
      #lp-overlay .lp-hero .pts { font-size:56px; font-weight:800; letter-spacing:-2px; line-height:1; }
      #lp-overlay .lp-hero .pts sub { font-size:16px; font-weight:400; opacity:.6; letter-spacing:0; }
      #lp-overlay .lp-hero .next { font-size:13px; opacity:.55; margin-top:8px; }
      #lp-overlay .lp-hero .next strong { opacity:1; color:#A5B4FC; }
      #lp-overlay .lp-bar { width:70%; margin:12px auto 0; height:5px; background:rgba(255,255,255,.12); border-radius:3px; overflow:hidden; }
      #lp-overlay .lp-bar .fill { height:100%; background:linear-gradient(90deg,#818CF8,#A78BFA); border-radius:3px; transition:width .5s; }
      #lp-overlay .lp-promo { display:inline-block; margin-top:12px; background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.18);
        border-radius:6px; padding:5px 16px; font-size:12px; }
      #lp-overlay .lp-promo code { font-weight:700; color:#A5B4FC; margin-left:4px; }
      #lp-overlay .lp-body { padding:20px 16px; }
      #lp-overlay .lp-section { margin-bottom:20px; }
      #lp-overlay .lp-section h3 { font-size:15px; font-weight:700; margin-bottom:10px; }
      #lp-overlay .lp-how { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
      #lp-overlay .lp-how > div { background:#fff; border:1px solid #E5E7EB; border-radius:10px; padding:14px 10px; text-align:center; }
      #lp-overlay .lp-how .ico { font-size:22px; margin-bottom:6px; }
      #lp-overlay .lp-how h4 { font-size:11px; font-weight:700; }
      #lp-overlay .lp-how p { font-size:10px; color:#6B7280; margin-top:2px; }
      #lp-overlay .lp-tiers { display:flex; gap:6px; }
      #lp-overlay .lp-tier { flex:1; background:#fff; border:1.5px solid #E5E7EB; border-radius:10px; padding:10px 4px; text-align:center; position:relative; }
      #lp-overlay .lp-tier.reached { border-color:#4F46E5; background:#EEF2FF; }
      #lp-overlay .lp-tier.current { border-color:#7C3AED; box-shadow:0 0 0 2px rgba(124,58,237,.15); }
      #lp-overlay .lp-tier .tn { font-size:11px; font-weight:700; }
      #lp-overlay .lp-tier .tp { font-size:9px; color:#6B7280; }
      #lp-overlay .lp-tier .ck { position:absolute; top:3px; right:5px; font-size:9px; color:#10B981; }
      #lp-overlay .lp-earn { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      #lp-overlay .lp-earn-item { background:#fff; border:1px solid #E5E7EB; border-radius:10px; padding:12px; display:flex; align-items:center; gap:10px; }
      #lp-overlay .lp-earn-item .ei { width:34px; height:34px; background:#EEF2FF; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
      #lp-overlay .lp-earn-item h4 { font-size:12px; font-weight:600; }
      #lp-overlay .lp-earn-item p { font-size:11px; color:#4F46E5; font-weight:600; }
      #lp-overlay .lp-rewards { display:flex; flex-direction:column; gap:8px; }
      #lp-overlay .lp-rw { background:#fff; border:1px solid #E5E7EB; border-radius:10px; padding:12px; display:flex; align-items:center; gap:10px; }
      #lp-overlay .lp-rw.locked { opacity:.45; }
      #lp-overlay .lp-rw .ri { width:34px; height:34px; background:#EEF2FF; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; }
      #lp-overlay .lp-rw h4 { font-size:12px; font-weight:600; }
      #lp-overlay .lp-rw p { font-size:10px; color:#6B7280; }
      #lp-overlay .lp-rw .rw-status { font-size:10px; font-weight:600; margin-top:1px; }
      #lp-overlay .lp-history { background:#fff; border:1px solid #E5E7EB; border-radius:10px; overflow:hidden; }
      #lp-overlay .lp-history table { width:100%; border-collapse:collapse; font-size:11px; }
      #lp-overlay .lp-history th { background:#F9FAFB; padding:8px 12px; text-align:left; font-weight:600; font-size:10px;
        text-transform:uppercase; color:#6B7280; letter-spacing:.4px; }
      #lp-overlay .lp-history td { padding:7px 12px; border-top:1px solid #E5E7EB; }
      #lp-overlay .lp-history .pos { color:#10B981; font-weight:600; }
      #lp-overlay .lp-history .neg { color:#EF4444; font-weight:600; }
      #lp-overlay .lp-footer { text-align:center; padding:12px; font-size:10px; color:#9CA3AF; }
    \`;
    document.head.appendChild(style);

    document.getElementById('lp-close-btn').addEventListener('click', function() {
      overlay.remove(); style.remove();
    });
  }

  function buildHTML(d) {
    var c = d.customer || {};
    var pts = c.points_balance || 0;
    var nextTier = d.next_tier;
    var currentTier = d.current_tier;
    var progress = 0;
    if (nextTier && currentTier) {
      var base = currentTier.min_points;
      progress = Math.min(100, Math.round(((pts - base) / (nextTier.min_points - base)) * 100));
    } else if (nextTier && !currentTier) {
      progress = Math.min(100, Math.round((pts / nextTier.min_points) * 100));
    } else { progress = 100; }

    var h = '';
    // Hero
    h += '<div class="lp-hero">';
    h += '<button class="lp-close" id="lp-close-btn">✕</button>';
    h += '<div class="pts">' + pts.toLocaleString() + '<sub> pts</sub></div>';
    if (nextTier) h += '<div class="next">Next level in <strong>' + nextTier.points_needed.toLocaleString() + ' pts</strong></div>';
    else h += '<div class="next">Maximum tier reached!</div>';
    h += '<div class="lp-bar"><div class="fill" style="width:' + progress + '%"></div></div>';
    if (c.promo_code) h += '<div class="lp-promo">Your code:<code>' + c.promo_code + '</code> (€' + (c.promo_value_eur || 0) + ' off)</div>';
    h += '</div>';

    h += '<div class="lp-body">';

    // How it works
    h += '<div class="lp-section"><h3>How does it work?</h3><div class="lp-how">';
    h += '<div><div class="ico">🛒</div><h4>Start your Journey</h4><p>Shop, achieve, and get rewarded.</p></div>';
    h += '<div><div class="ico">📊</div><h4>Collect points</h4><p>' + (d.settings?.points_per_eur || 1) + ' pt per €1 spent.</p></div>';
    h += '<div><div class="ico">🎁</div><h4>Get benefits</h4><p>Unlock perks at each tier.</p></div>';
    h += '</div></div>';

    // Tiers
    if ((d.tiers || []).length) {
      var topTier = d.tiers[d.tiers.length - 1];
      h += '<div class="lp-section"><h3>Unlock ' + topTier.name + ' Privilege</h3><div class="lp-tiers">';
      d.tiers.forEach(function(t) {
        var cls = 'lp-tier';
        if (t.reached) cls += ' reached';
        if (currentTier && t.name === currentTier.name) cls += ' current';
        h += '<div class="' + cls + '">';
        if (t.reached) h += '<span class="ck">✓</span>';
        h += '<div class="tn">' + t.name + '</div>';
        h += '<div class="tp">' + t.min_points.toLocaleString() + '</div>';
        h += '</div>';
      });
      h += '</div></div>';
    }

    // Earn
    h += '<div class="lp-section"><h3>Collect Points</h3><div class="lp-earn">';
    h += '<div class="lp-earn-item"><div class="ei">🛍️</div><div><h4>Make a purchase</h4><p>€1 = ' + (d.settings?.points_per_eur || 1) + ' pt' + ((d.settings?.points_per_eur || 1) > 1 ? 's' : '') + '</p></div></div>';
    h += '<div class="lp-earn-item"><div class="ei">💝</div><div><h4>Invite a friend</h4><p>Coming soon</p></div></div>';
    h += '</div></div>';

    // Rewards
    if ((d.rewards || []).length) {
      h += '<div class="lp-section"><h3>Your Rewards</h3><div class="lp-rewards">';
      d.rewards.forEach(function(r) {
        var icon = r.discount_method === 'shipping' ? '🚚' : r.discount_method === 'percent' ? '💎' : '💰';
        h += '<div class="lp-rw' + (r.available ? '' : ' locked') + '"><div class="ri">' + icon + '</div><div>';
        h += '<h4>' + r.name + '</h4>';
        if (r.description) h += '<p>' + r.description + '</p>';
        h += '<div class="rw-status" style="color:' + (r.available ? '#10B981' : '#6B7280') + '">';
        h += r.available ? '✓ Available now' : r.min_points_cost.toLocaleString() + ' pts needed';
        h += '</div></div></div>';
      });
      h += '</div></div>';
    }

    // History
    if ((d.recent_activity || []).length) {
      h += '<div class="lp-section"><h3>Your Points</h3><div class="lp-history"><table>';
      h += '<tr><th>Date</th><th>Activity</th><th style="text-align:right">Points</th></tr>';
      d.recent_activity.forEach(function(tx) {
        var cls = tx.points >= 0 ? 'pos' : 'neg';
        h += '<tr><td>' + new Date(tx.date).toLocaleDateString() + '</td>';
        h += '<td>' + (tx.description || tx.type) + '</td>';
        h += '<td style="text-align:right" class="' + cls + '">' + (tx.points > 0 ? '+' : '') + tx.points.toLocaleString() + '</td></tr>';
      });
      h += '</table></div></div>';
    }

    h += '<div class="lp-footer">Current: <strong>' + pts.toLocaleString() + '</strong> pts · Lifetime: <strong>' + (c.lifetime_points || 0).toLocaleString() + '</strong> pts · ' + (d.settings?.points_to_eur_rate || 100) + ' pts = €1</div>';
    h += '</div>'; // /lp-body
    return h;
  }
})();
`;

  return c.text(js, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
});

export default customer;
