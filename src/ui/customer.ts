// ============================================================
// Customer-facing loyalty page (standalone, BestSecret-style)
// Fetches data via /c/:slug/api/me?email=X&token=Y
// ============================================================
export const customerPageHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Loyalty Points</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: #FAFAFA; color: #1E1E2F; line-height: 1.55; }
    .lp-loading { text-align: center; padding: 100px 20px; font-size: 16px; color: #9CA3AF; }
    .lp-error { text-align: center; padding: 100px 20px; color: #EF4444; }

    .lp-hero { text-align: center; padding: 56px 20px 40px; background: linear-gradient(135deg, #1E1E2F 0%, #312E81 100%); color: #fff; }
    .lp-hero .greeting { font-size: 14px; opacity: .6; margin-bottom: 4px; }
    .lp-hero .pts { font-size: 72px; font-weight: 800; letter-spacing: -3px; line-height: 1; }
    .lp-hero .pts sub { font-size: 20px; font-weight: 400; opacity: .6; letter-spacing: 0; }
    .lp-hero .next { font-size: 14px; opacity: .5; margin-top: 10px; }
    .lp-hero .next strong { opacity: 1; color: #A5B4FC; }
    .lp-bar-outer { width: 60%; max-width: 300px; margin: 14px auto 0; height: 6px; background: rgba(255,255,255,.12); border-radius: 3px; overflow: hidden; }
    .lp-bar-inner { height: 100%; background: linear-gradient(90deg, #818CF8, #A78BFA); border-radius: 3px; transition: width .6s ease; }
    .lp-promo { display: inline-block; margin-top: 16px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 8px 20px; font-size: 13px; }
    .lp-promo code { font-weight: 700; color: #A5B4FC; margin-left: 6px; letter-spacing: .5px; }

    .lp-container { max-width: 720px; margin: 0 auto; padding: 32px 20px 40px; }
    .lp-section { margin-bottom: 32px; }
    .lp-section h2 { font-size: 18px; font-weight: 700; margin-bottom: 14px; }

    .lp-how { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    @media (max-width: 500px) { .lp-how { grid-template-columns: 1fr; } }
    .lp-how-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 24px 16px; text-align: center; }
    .lp-how-card .ico { font-size: 28px; margin-bottom: 10px; }
    .lp-how-card h3 { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
    .lp-how-card p { font-size: 12px; color: #6B7280; }

    .lp-tiers-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .lp-tier-card { flex: 1; min-width: 100px; background: #fff; border: 2px solid #E5E7EB; border-radius: 12px; padding: 14px 8px; text-align: center; position: relative; transition: all .2s; }
    .lp-tier-card.reached { border-color: #4F46E5; background: #EEF2FF; }
    .lp-tier-card.current { border-color: #7C3AED; box-shadow: 0 0 0 3px rgba(124,58,237,.12); }
    .lp-tier-card .tn { font-size: 13px; font-weight: 700; }
    .lp-tier-card .tp { font-size: 11px; color: #6B7280; margin-top: 2px; }
    .lp-tier-card .ck { position: absolute; top: 5px; right: 7px; font-size: 11px; color: #10B981; }
    .lp-tier-card .level-badge { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: #7C3AED; color: #fff; font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }

    .lp-earn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 500px) { .lp-earn-grid { grid-template-columns: 1fr; } }
    .lp-earn-card { background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 12px; }
    .lp-earn-card .ei { width: 42px; height: 42px; background: #EEF2FF; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
    .lp-earn-card h3 { font-size: 14px; font-weight: 600; }
    .lp-earn-card p { font-size: 13px; color: #4F46E5; font-weight: 600; margin-top: 2px; }

    .lp-rewards-list { display: flex; flex-direction: column; gap: 10px; }
    .lp-reward { background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 12px; }
    .lp-reward.locked { opacity: .4; }
    .lp-reward .ri { width: 42px; height: 42px; background: #EEF2FF; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0; }
    .lp-reward h3 { font-size: 14px; font-weight: 600; }
    .lp-reward p { font-size: 12px; color: #6B7280; }
    .lp-reward .status { font-size: 12px; font-weight: 600; margin-top: 2px; }

    .lp-history { background: #fff; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; }
    .lp-history table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .lp-history th { background: #F9FAFB; padding: 10px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; color: #6B7280; letter-spacing: .5px; }
    .lp-history td { padding: 10px 16px; border-top: 1px solid #F3F4F6; }
    .lp-history .pos { color: #10B981; font-weight: 600; }
    .lp-history .neg { color: #EF4444; font-weight: 600; }
    .lp-history .type-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; }
    .lp-history .type-earn { background: #D1FAE5; color: #065F46; }
    .lp-history .type-redeem { background: #DBEAFE; color: #1E40AF; }
    .lp-history .type-adjust { background: #FEF3C7; color: #92400E; }

    .lp-footer { text-align: center; padding: 20px; font-size: 12px; color: #9CA3AF; border-top: 1px solid #F3F4F6; margin-top: 12px; }
    .lp-footer strong { color: #6B7280; }
  </style>
</head>
<body>
  <div id="lp-root"><div class="lp-loading">Loading your loyalty points...</div></div>
  <script>
  (function() {
    var params = new URLSearchParams(window.location.search);
    var email = params.get('email');
    var token = params.get('token');
    var slug = window.location.pathname.split('/c/')[1]?.split('/')[0];

    if (!email || !token || !slug) {
      document.getElementById('lp-root').innerHTML = '<div class="lp-error">Missing parameters. URL should be /c/{slug}/page?email=X&token=Y</div>';
      return;
    }

    fetch('/c/' + slug + '/api/me?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) throw new Error(d.error);
        document.getElementById('lp-root').innerHTML = render(d);
      })
      .catch(function(e) {
        document.getElementById('lp-root').innerHTML = '<div class="lp-error">' + e.message + '</div>';
      });

    function render(d) {
      var c = d.customer || {};
      var pts = c.points_balance || 0;
      var currentTier = d.current_tier;
      var nextTier = d.next_tier;
      var progress = 0;
      if (nextTier && currentTier) {
        var base = currentTier.min_points;
        progress = Math.min(100, Math.round(((pts - base) / (nextTier.min_points - base)) * 100));
      } else if (nextTier && !currentTier) {
        progress = Math.min(100, Math.round((pts / nextTier.min_points) * 100));
      } else { progress = 100; }

      var h = '';

      h += '<div class="lp-hero">';
      if (c.first_name) h += '<div class="greeting">Welcome back, ' + c.first_name + '</div>';
      h += '<div class="pts">' + pts.toLocaleString() + '<sub> pts</sub></div>';
      if (nextTier) h += '<div class="next">Next level in <strong>' + nextTier.points_needed.toLocaleString() + ' pts</strong></div>';
      else h += '<div class="next">Maximum tier reached!</div>';
      h += '<div class="lp-bar-outer"><div class="lp-bar-inner" style="width:' + progress + '%"></div></div>';
      if (c.promo_code) h += '<div class="lp-promo">Your discount code:<code>' + c.promo_code + '</code> (\\u20ac' + (c.promo_value_eur || 0) + ' off)</div>';
      h += '</div>';

      h += '<div class="lp-container">';

      h += '<div class="lp-section"><h2>How does it work?</h2><div class="lp-how">';
      h += '<div class="lp-how-card"><div class="ico">\\ud83d\\uded2</div><h3>Start your Journey</h3><p>Shop, achieve, and get rewarded.</p></div>';
      h += '<div class="lp-how-card"><div class="ico">\\ud83d\\udcca</div><h3>Collect points & level up</h3><p>Collect ' + (d.settings?.points_per_eur || 1) + ' point' + ((d.settings?.points_per_eur||1)>1?'s':'') + ' for every euro spent and track your progress at any time.</p></div>';
      h += '<div class="lp-how-card"><div class="ico">\\ud83c\\udf81</div><h3>Uncover all the benefits</h3><p>Reach new levels to unlock experiences and exclusive perks.</p></div>';
      h += '</div></div>';

      if ((d.tiers || []).length) {
        var topTier = d.tiers[d.tiers.length - 1];
        h += '<div class="lp-section"><h2>Unlock your ' + topTier.name + ' Privilege</h2>';
        h += '<p style="font-size:13px;color:#6B7280;margin:-8px 0 14px;">STARTS AT LEVEL 1 \\u2013 ' + (nextTier ? nextTier.points_needed.toLocaleString() : '0') + ' PTS REMAINING</p>';
        h += '<div class="lp-tiers-row">';
        d.tiers.forEach(function(t, i) {
          var cls = 'lp-tier-card';
          if (t.reached) cls += ' reached';
          if (currentTier && t.name === currentTier.name) cls += ' current';
          h += '<div class="' + cls + '">';
          if (currentTier && t.name === currentTier.name) h += '<div class="level-badge">YOU ARE HERE</div>';
          if (t.reached) h += '<span class="ck">\\u2713</span>';
          h += '<div class="tn">' + t.name + '</div>';
          h += '<div class="tp">' + t.min_points.toLocaleString() + ' pts</div>';
          h += '</div>';
        });
        h += '</div></div>';
      }

      h += '<div class="lp-section"><h2>Collect Points</h2><div class="lp-earn-grid">';
      h += '<div class="lp-earn-card"><div class="ei">\\ud83d\\udecd\\ufe0f</div><div><h3>Make a purchase</h3><p>\\u20ac1 = ' + (d.settings?.points_per_eur || 1) + ' point' + ((d.settings?.points_per_eur||1)>1?'s':'') + '</p></div></div>';
      h += '<div class="lp-earn-card"><div class="ei">\\ud83d\\udc9d</div><div><h3>Invite a friend</h3><p>+100 pts</p></div></div>';
      h += '</div></div>';

      if ((d.rewards || []).length) {
        h += '<div class="lp-section"><h2>Your Rewards</h2><div class="lp-rewards-list">';
        d.rewards.forEach(function(r) {
          var icon = r.discount_method === 'shipping' ? '\\ud83d\\ude9a' : r.discount_method === 'percent' ? '\\ud83d\\udc8e' : '\\ud83d\\udcb0';
          h += '<div class="lp-reward' + (r.available ? '' : ' locked') + '">';
          h += '<div class="ri">' + icon + '</div><div>';
          h += '<h3>' + r.name + '</h3>';
          if (r.description) h += '<p>' + r.description + '</p>';
          h += '<div class="status" style="color:' + (r.available ? '#10B981' : '#6B7280') + '">';
          h += r.available ? '\\u2713 Available now' : r.min_points_cost.toLocaleString() + ' pts needed';
          h += '</div></div></div>';
        });
        h += '</div></div>';
      }

      if ((d.recent_activity || []).length) {
        h += '<div class="lp-section"><h2>Your Points</h2>';
        h += '<p style="font-size:13px;color:#6B7280;margin:-8px 0 14px;">Current points: <strong style="color:#1E1E2F">' + pts.toLocaleString() + '</strong></p>';
        h += '<div class="lp-history"><table>';
        h += '<tr><th>Date</th><th>Activity</th><th>Type</th><th style="text-align:right">Points</th></tr>';
        d.recent_activity.forEach(function(tx) {
          var cls = tx.points >= 0 ? 'pos' : 'neg';
          h += '<tr>';
          h += '<td>' + new Date(tx.date).toLocaleDateString() + '</td>';
          h += '<td>' + (tx.description || tx.type) + '</td>';
          h += '<td><span class="type-badge type-' + tx.type + '">' + tx.type + '</span></td>';
          h += '<td style="text-align:right" class="' + cls + '">' + (tx.points > 0 ? '+' : '') + tx.points.toLocaleString() + '</td>';
          h += '</tr>';
        });
        h += '</table></div></div>';
      }

      h += '<div class="lp-footer">Current: <strong>' + pts.toLocaleString() + '</strong> pts &middot; Lifetime: <strong>' + (c.lifetime_points||0).toLocaleString() + '</strong> pts &middot; ' + (d.settings?.points_to_eur_rate||100) + ' pts = \\u20ac1</div>';
      h += '</div>';
      return h;
    }
  })();
  </script>
</body>
</html>`;

// ============================================================
// Compact widget (for iframe embedding inside CloudCart stores)
// ============================================================
export const widgetHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: transparent; color: #1E1E2F; line-height: 1.5; }
    .w-loading { text-align: center; padding: 40px; font-size: 14px; color: #9CA3AF; }
    .w-hero { text-align: center; padding: 32px 16px 24px; background: linear-gradient(135deg, #1E1E2F 0%, #312E81 100%); color: #fff; border-radius: 14px 14px 0 0; }
    .w-hero .pts { font-size: 48px; font-weight: 800; letter-spacing: -2px; }
    .w-hero .pts sub { font-size: 14px; font-weight: 400; opacity: .6; }
    .w-hero .next { font-size: 12px; opacity: .5; margin-top: 6px; }
    .w-hero .next strong { color: #A5B4FC; opacity: 1; }
    .w-bar { width: 60%; margin: 10px auto 0; height: 4px; background: rgba(255,255,255,.12); border-radius: 2px; }
    .w-bar .fill { height: 100%; background: linear-gradient(90deg,#818CF8,#A78BFA); border-radius: 2px; }
    .w-promo { display: inline-block; margin-top: 10px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: 4px 14px; font-size: 11px; }
    .w-promo code { font-weight: 700; color: #A5B4FC; margin-left: 4px; }
    .w-body { padding: 16px; }
    .w-section { margin-bottom: 16px; }
    .w-section h3 { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
    .w-tiers { display: flex; gap: 4px; }
    .w-t { flex: 1; background: #fff; border: 1.5px solid #E5E7EB; border-radius: 8px; padding: 8px 4px; text-align: center; font-size: 10px; position: relative; }
    .w-t.reached { border-color: #4F46E5; background: #EEF2FF; }
    .w-t.current { border-color: #7C3AED; box-shadow: 0 0 0 2px rgba(124,58,237,.12); }
    .w-t .tn { font-weight: 700; font-size: 10px; }
    .w-t .tp { color: #6B7280; font-size: 9px; }
    .w-t .ck { position: absolute; top: 2px; right: 4px; font-size: 8px; color: #10B981; }
    .w-rewards { display: flex; flex-direction: column; gap: 6px; }
    .w-rw { background: #fff; border: 1px solid #E5E7EB; border-radius: 8px; padding: 10px; display: flex; align-items: center; gap: 8px; font-size: 11px; }
    .w-rw.locked { opacity: .4; }
    .w-rw .ri { width: 28px; height: 28px; background: #EEF2FF; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
    .w-rw h4 { font-size: 11px; font-weight: 600; }
    .w-rw p { font-size: 10px; color: #6B7280; }
    .w-footer { text-align: center; font-size: 10px; color: #9CA3AF; padding: 8px; }
  </style>
</head>
<body>
  <div id="w-root"><div class="w-loading">Loading...</div></div>
  <script>
  (function() {
    var params = new URLSearchParams(window.location.search);
    var email = params.get('email');
    var token = params.get('token');
    var slug = window.location.pathname.split('/c/')[1]?.split('/')[0];
    if (!email || !token || !slug) return;

    fetch('/c/' + slug + '/api/me?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.error) throw new Error(d.error);
        document.getElementById('w-root').innerHTML = render(d);
        try { window.parent.postMessage({ type: 'loyalty-resize', height: document.body.scrollHeight }, '*'); } catch(e) {}
      })
      .catch(function(e) { document.getElementById('w-root').innerHTML = '<div class="w-loading" style="color:#EF4444">' + e.message + '</div>'; });

    function render(d) {
      var c = d.customer || {};
      var pts = c.points_balance || 0;
      var currentTier = d.current_tier;
      var nextTier = d.next_tier;
      var progress = 0;
      if (nextTier && currentTier) progress = Math.min(100, Math.round(((pts - currentTier.min_points) / (nextTier.min_points - currentTier.min_points)) * 100));
      else if (nextTier) progress = Math.min(100, Math.round((pts / nextTier.min_points) * 100));
      else progress = 100;

      var h = '<div class="w-hero">';
      h += '<div class="pts">' + pts.toLocaleString() + '<sub> pts</sub></div>';
      if (nextTier) h += '<div class="next">Next level in <strong>' + nextTier.points_needed.toLocaleString() + ' pts</strong></div>';
      h += '<div class="w-bar"><div class="fill" style="width:' + progress + '%"></div></div>';
      if (c.promo_code) h += '<div class="w-promo">Code:<code>' + c.promo_code + '</code> (\\u20ac' + (c.promo_value_eur||0) + ')</div>';
      h += '</div><div class="w-body">';

      if ((d.tiers||[]).length) {
        h += '<div class="w-section"><h3>Tiers</h3><div class="w-tiers">';
        d.tiers.forEach(function(t) {
          var cls = 'w-t'; if (t.reached) cls += ' reached'; if (currentTier && t.name === currentTier.name) cls += ' current';
          h += '<div class="' + cls + '">' + (t.reached ? '<span class="ck">\\u2713</span>' : '') + '<div class="tn">' + t.name + '</div><div class="tp">' + t.min_points.toLocaleString() + '</div></div>';
        });
        h += '</div></div>';
      }

      if ((d.rewards||[]).length) {
        h += '<div class="w-section"><h3>Rewards</h3><div class="w-rewards">';
        d.rewards.forEach(function(r) {
          var icon = r.discount_method==='shipping'?'\\ud83d\\ude9a':r.discount_method==='percent'?'\\ud83d\\udc8e':'\\ud83d\\udcb0';
          h += '<div class="w-rw' + (r.available?'':' locked') + '"><div class="ri">' + icon + '</div><div><h4>' + r.name + '</h4>';
          h += '<p style="color:' + (r.available?'#10B981':'#6B7280') + ';font-weight:600">' + (r.available?'\\u2713 Available':r.min_points_cost.toLocaleString()+' pts needed') + '</p></div></div>';
        });
        h += '</div></div>';
      }

      h += '<div class="w-footer">' + (d.settings?.points_per_eur||1) + ' pts per \\u20ac1 &middot; ' + (d.settings?.points_to_eur_rate||100) + ' pts = \\u20ac1</div>';
      h += '</div>';
      return h;
    }
  })();
  </script>
</body>
</html>`;
