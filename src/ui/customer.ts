// ============================================================
// Customer-facing loyalty page (standalone full page)
// ============================================================
export const customerPageHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>My Loyalty Points</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--primary:#4F46E5;--primary-light:#EEF2FF;--accent:#7C3AED;--bg:#FAFAFA;--card:#FFF;--text:#1E1E2F;--muted:#6B7280;--border:#E5E7EB;--green:#10B981;--radius:16px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
.lp-wrap{max-width:720px;margin:0 auto;padding:24px 16px}
.lp-hero{text-align:center;padding:48px 24px;background:linear-gradient(135deg,#1E1E2F 0%,#312E81 100%);border-radius:var(--radius);color:#fff;margin-bottom:32px}
.lp-hero .pts{font-size:72px;font-weight:800;letter-spacing:-2px;line-height:1}
.lp-hero .pts-label{font-size:18px;font-weight:400;opacity:.7;margin-top:4px}
.lp-hero .next-level{font-size:14px;opacity:.6;margin-top:12px}
.lp-hero .next-level strong{opacity:1;color:#A5B4FC}
.lp-progress-bar{width:80%;max-width:320px;margin:16px auto 0;height:6px;background:rgba(255,255,255,.15);border-radius:3px;overflow:hidden}
.lp-progress-bar .fill{height:100%;background:linear-gradient(90deg,#818CF8,#A78BFA);border-radius:3px;transition:width .6s ease}
.lp-promo{display:inline-block;margin-top:16px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px 20px;font-size:14px}
.lp-promo code{font-weight:700;font-size:16px;color:#A5B4FC;margin-left:4px}

.lp-section{margin-bottom:28px}
.lp-section h2{font-size:18px;font-weight:700;margin-bottom:16px}

.lp-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.lp-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center}
.lp-card .icon{font-size:28px;margin-bottom:8px}
.lp-card h3{font-size:14px;font-weight:700;margin-bottom:4px}
.lp-card p{font-size:12px;color:var(--muted)}

.lp-tiers{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.lp-tier{flex:1;min-width:100px;background:var(--card);border:2px solid var(--border);border-radius:12px;padding:16px 12px;text-align:center;position:relative;transition:all .2s}
.lp-tier.reached{border-color:var(--primary);background:var(--primary-light)}
.lp-tier.current{border-color:var(--accent);box-shadow:0 0 0 3px rgba(124,58,237,.15)}
.lp-tier .tier-name{font-size:13px;font-weight:700}
.lp-tier .tier-pts{font-size:11px;color:var(--muted);margin-top:2px}
.lp-tier .check{position:absolute;top:6px;right:8px;font-size:12px;color:var(--green)}

.lp-rewards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.lp-reward{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px}
.lp-reward .rw-icon{width:40px;height:40px;border-radius:10px;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.lp-reward .rw-info h4{font-size:13px;font-weight:600}
.lp-reward .rw-info p{font-size:11px;color:var(--muted)}
.lp-reward.locked{opacity:.5}

.lp-earn{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.lp-earn-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;display:flex;align-items:center;gap:12px;cursor:default}
.lp-earn-card .earn-icon{width:40px;height:40px;border-radius:10px;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.lp-earn-card h4{font-size:13px;font-weight:600}
.lp-earn-card p{font-size:12px;color:var(--primary);font-weight:600}

.lp-history{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.lp-history table{width:100%;border-collapse:collapse;font-size:13px}
.lp-history th{background:#F9FAFB;padding:10px 16px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:var(--muted);letter-spacing:.5px}
.lp-history td{padding:10px 16px;border-top:1px solid var(--border)}
.lp-history .pos{color:var(--green);font-weight:600}
.lp-history .neg{color:#EF4444;font-weight:600}

.lp-loading{text-align:center;padding:60px;color:var(--muted)}
.lp-error{text-align:center;padding:40px;color:#EF4444}
</style>
</head>
<body>
<div class="lp-wrap" id="loyaltyApp">
  <div class="lp-loading" id="lp-loading">Loading your loyalty data…</div>
</div>
<script>
(function(){
  var params = new URLSearchParams(window.location.search);
  var slug = window.location.pathname.split('/c/')[1]?.split('/')[0] || '';
  var email = params.get('email') || '';
  var token = params.get('token') || '';
  if (!slug || !email || !token) {
    document.getElementById('lp-loading').innerHTML = '<div class="lp-error">Missing parameters. URL should be /c/{slug}/page?email=X&token=Y</div>';
    return;
  }
  fetch('/c/' + slug + '/api/me?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token))
    .then(function(r){ return r.json(); })
    .then(function(d){ if(d.error) throw new Error(d.error); render(d); })
    .catch(function(e){ document.getElementById('lp-loading').innerHTML = '<div class="lp-error">' + e.message + '</div>'; });

  function render(d) {
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

    var html = '';
    // Hero
    html += '<div class="lp-hero">';
    html += '<div class="pts">' + pts.toLocaleString() + '<span class="pts-label"> pts</span></div>';
    if (nextTier) html += '<div class="next-level">Next level in <strong>' + nextTier.points_needed.toLocaleString() + ' pts</strong></div>';
    else html += '<div class="next-level">Maximum tier reached!</div>';
    html += '<div class="lp-progress-bar"><div class="fill" style="width:' + progress + '%"></div></div>';
    if (c.promo_code) html += '<div class="lp-promo">Your code:<code>' + c.promo_code + '</code> (€' + (c.promo_value_eur||0) + ' off)</div>';
    html += '</div>';

    // How it works
    html += '<div class="lp-section"><h2>How does it work?</h2><div class="lp-cards">';
    html += '<div class="lp-card"><div class="icon">🛒</div><h3>Start your Journey</h3><p>Shop, achieve, and get rewarded.</p></div>';
    html += '<div class="lp-card"><div class="icon">📊</div><h3>Collect points & level up</h3><p>Collect ' + (d.settings?.points_per_eur||1) + ' point' + ((d.settings?.points_per_eur||1)>1?'s':'') + ' for every €1 spent and track your progress.</p></div>';
    html += '<div class="lp-card"><div class="icon">🎁</div><h3>Uncover all the benefits</h3><p>Reach new levels to unlock experiences and exclusive perks.</p></div>';
    html += '</div></div>';

    // Tiers
    html += '<div class="lp-section"><h2>Unlock your ' + (d.tiers?.length ? d.tiers[d.tiers.length-1].name : 'Top') + ' Privilege</h2>';
    html += '<div class="lp-tiers">';
    (d.tiers||[]).forEach(function(t){
      var cls = 'lp-tier';
      if (t.reached) cls += ' reached';
      if (currentTier && t.name === currentTier.name) cls += ' current';
      html += '<div class="' + cls + '">';
      if (t.reached) html += '<span class="check">✓</span>';
      html += '<div class="tier-name">' + t.name + '</div>';
      html += '<div class="tier-pts">' + t.min_points.toLocaleString() + ' pts</div>';
      html += '</div>';
    });
    html += '</div></div>';

    // Earn points
    html += '<div class="lp-section"><h2>Collect Points</h2><div class="lp-earn">';
    html += '<div class="lp-earn-card"><div class="earn-icon">🛍️</div><div><h4>Make a purchase</h4><p>€1 = ' + (d.settings?.points_per_eur||1) + ' point' + ((d.settings?.points_per_eur||1)>1?'s':'') + '</p></div></div>';
    html += '<div class="lp-earn-card"><div class="earn-icon">💝</div><div><h4>Invite a friend</h4><p>Coming soon</p></div></div>';
    html += '</div></div>';

    // Rewards
    if ((d.rewards||[]).length) {
      html += '<div class="lp-section"><h2>Your Rewards</h2><div class="lp-rewards">';
      d.rewards.forEach(function(r){
        var icon = r.discount_method === 'shipping' ? '🚚' : r.discount_method === 'percent' ? '%' : '€';
        var cls = r.available ? 'lp-reward' : 'lp-reward locked';
        html += '<div class="' + cls + '"><div class="rw-icon">' + icon + '</div><div class="rw-info"><h4>' + r.name + '</h4>';
        html += '<p>' + (r.description||'') + '</p>';
        if (r.min_points_cost) html += '<p style="margin-top:2px;color:#4F46E5;font-weight:600">' + (r.available ? '✓ Available' : r.min_points_cost.toLocaleString() + ' pts needed') + '</p>';
        html += '</div></div>';
      });
      html += '</div></div>';
    }

    // History
    if ((d.recent_activity||[]).length) {
      html += '<div class="lp-section"><h2>Your Points</h2><div class="lp-history"><table>';
      html += '<tr><th>Date</th><th>Activity</th><th style="text-align:right">Points</th></tr>';
      d.recent_activity.forEach(function(tx){
        var cls = tx.points >= 0 ? 'pos' : 'neg';
        html += '<tr><td>' + new Date(tx.date).toLocaleDateString() + '</td>';
        html += '<td>' + (tx.description||tx.type) + '</td>';
        html += '<td style="text-align:right" class="' + cls + '">' + (tx.points>0?'+':'') + tx.points.toLocaleString() + '</td></tr>';
      });
      html += '</table></div></div>';
    }

    // Summary
    html += '<div class="lp-section" style="text-align:center;padding:20px;color:#6B7280;font-size:12px">';
    html += 'Current points: <strong>' + pts.toLocaleString() + '</strong>';
    html += ' · Lifetime earned: <strong>' + (c.lifetime_points||0).toLocaleString() + '</strong>';
    html += ' · ' + (d.settings?.points_to_eur_rate||100) + ' points = €1 discount';
    html += '</div>';

    document.getElementById('loyaltyApp').innerHTML = html;
  }
})();
</script>
</body>
</html>`;

// ============================================================
// Compact widget (for iframe embedding)
// ============================================================
export const widgetHtml = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;color:#1E1E2F;line-height:1.5;padding:12px}
.w-hero{text-align:center;padding:32px 16px;background:linear-gradient(135deg,#1E1E2F,#312E81);border-radius:14px;color:#fff;margin-bottom:16px}
.w-hero .pts{font-size:48px;font-weight:800;letter-spacing:-1px;line-height:1}
.w-hero .sub{font-size:13px;opacity:.6;margin-top:8px}
.w-hero .sub strong{color:#A5B4FC;opacity:1}
.w-bar{width:70%;margin:10px auto 0;height:4px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden}
.w-bar .fill{height:100%;background:#818CF8;border-radius:2px}
.w-promo{display:inline-block;margin-top:10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:5px 14px;font-size:12px}
.w-promo code{font-weight:700;color:#A5B4FC}
.w-tiers{display:flex;gap:6px;margin-bottom:16px}
.w-tier{flex:1;padding:10px 6px;border:1.5px solid #E5E7EB;border-radius:10px;text-align:center;font-size:11px;font-weight:600;background:#fff}
.w-tier.reached{border-color:#4F46E5;background:#EEF2FF}
.w-tier .tp{font-size:10px;color:#6B7280;font-weight:400}
.w-section h3{font-size:14px;font-weight:700;margin-bottom:8px}
.w-earn{display:flex;gap:8px;margin-bottom:16px}
.w-earn>div{flex:1;background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:12px;font-size:12px}
.w-earn h4{font-weight:600;font-size:12px}
.w-earn p{color:#4F46E5;font-weight:600;font-size:11px}
.w-loading{text-align:center;padding:40px;color:#6B7280}
</style>
</head>
<body>
<div id="wApp"><div class="w-loading">Loading…</div></div>
<script>
(function(){
  var params = new URLSearchParams(window.location.search);
  var slug = window.location.pathname.split('/c/')[1]?.split('/')[0] || '';
  var email = params.get('email') || '';
  var token = params.get('token') || '';
  if(!slug||!email||!token){document.getElementById('wApp').innerHTML='<p style="color:red;font-size:12px">Missing params</p>';return;}
  var origin = window.location.origin;
  fetch(origin+'/c/'+slug+'/api/me?email='+encodeURIComponent(email)+'&token='+encodeURIComponent(token))
    .then(function(r){return r.json()})
    .then(function(d){if(d.error)throw new Error(d.error);render(d)})
    .catch(function(e){document.getElementById('wApp').innerHTML='<p style="color:red">'+e.message+'</p>'});

  function render(d){
    var c=d.customer||{};var pts=c.points_balance||0;
    var nextTier=d.next_tier;var currentTier=d.current_tier;
    var progress=0;
    if(nextTier&&currentTier){var b=currentTier.min_points;progress=Math.min(100,Math.round(((pts-b)/(nextTier.min_points-b))*100))}
    else if(nextTier){progress=Math.min(100,Math.round((pts/nextTier.min_points)*100))}
    else{progress=100}
    var h='<div class="w-hero"><div class="pts">'+pts.toLocaleString()+'<span style="font-size:16px;opacity:.7"> pts</span></div>';
    if(nextTier)h+='<div class="sub">Next level in <strong>'+nextTier.points_needed.toLocaleString()+' pts</strong></div>';
    h+='<div class="w-bar"><div class="fill" style="width:'+progress+'%"></div></div>';
    if(c.promo_code)h+='<div class="w-promo">Code: <code>'+c.promo_code+'</code> (€'+(c.promo_value_eur||0)+')</div>';
    h+='</div>';
    h+='<div class="w-tiers">';
    (d.tiers||[]).forEach(function(t){h+='<div class="w-tier'+(t.reached?' reached':'')+'">'+t.name+'<div class="tp">'+t.min_points.toLocaleString()+'</div></div>'});
    h+='</div>';
    h+='<div class="w-section"><h3>Collect Points</h3><div class="w-earn">';
    h+='<div><h4>🛍️ Purchase</h4><p>€1 = '+(d.settings?.points_per_eur||1)+' pt'+(d.settings?.points_per_eur>1?'s':'')+'</p></div>';
    h+='<div><h4>💝 Refer</h4><p>Coming soon</p></div></div></div>';
    document.getElementById('wApp').innerHTML=h;
    if(window.parent!==window)window.parent.postMessage({type:'loyalty-resize',height:document.body.scrollHeight},'*');
  }
})();
</script>
</body>
</html>`;
