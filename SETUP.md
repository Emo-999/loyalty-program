# Loyalty Program — Setup Guide

## Stack
- **Runtime**: Cloudflare Workers (Hono framework)
- **Database**: Supabase (PostgreSQL)
- **Deploy**: `wrangler deploy`

---

## 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run `supabase/schema.sql` — creates all tables + default tiers + settings
3. Copy your **Project URL** and **service_role key** (Settings → API)

---

## 2. Cloudflare Workers

### First-time setup
```bash
npm install
npx wrangler login
```

### Set secrets (run each command, it will prompt for the value)
```bash
npx wrangler secret put CLOUDCART_API_KEY
# value: AHFXP1EC5XCB9WZ0OB1VH95MMGFYNKCJ1PWXFJK4A9S3HZVYL2Q8HM2V0AKXDDC3

npx wrangler secret put SUPABASE_URL
# value: https://xxxx.supabase.co

npx wrangler secret put SUPABASE_SERVICE_KEY
# value: eyJ... (service_role key from Supabase)

npx wrangler secret put ADMIN_PASSWORD
# value: choose a strong password

npx wrangler secret put WEBHOOK_SECRET
# value: any random string, e.g. openssl rand -hex 16
```

### Deploy
```bash
npm run deploy
```

Your worker will be live at: `https://loyalty-program.<your-cf-subdomain>.workers.dev`

---

## 3. Initial Setup (one-time)

After deploying, open the admin dashboard and click **Run Setup**, or call:

```bash
curl -X POST https://loyalty-program.<subdomain>.workers.dev/api/setup \
  -u admin:<your-admin-password>
```

This will:
- Create CloudCart customer groups for each tier (Bronze → Diamond)
- Register webhooks on CloudCart for `order.created` and `order.updated`

Then click **Sync Customers** (or `POST /api/setup/sync-existing`) to import existing CloudCart customers.

---

## 4. How it works

### Points earn flow
1. Customer places an order on the CloudCart store
2. When order status changes to **`paid`** (configurable), CloudCart sends a webhook
3. Worker calculates points: `floor(order_total_EUR × points_per_EUR)`
4. Points balance updated in Supabase
5. Customer's **personal promo code** value updated on CloudCart (e.g. `LOYALTY3` = €12 off)
6. Customer **tier** updated (group_id on CloudCart)
7. Customer **note** updated in CloudCart admin:
   ```
   🎯 LOYALTY POINTS
   Points: 1,250
   Tier: Silver
   Promo code: LOYALTY3 (€12 discount)
   ```

### Points redemption
- Customer enters their code (e.g. `LOYALTY3`) at checkout → discount applied automatically
- Admin manually marks redemption via dashboard: **Customers → Adjust**
- Promo code value is reset to reflect new balance

### Bonus rules (hero products)
Add rules in **⚡ Bonus Rules** tab:
- **Product IDs**: +50 pts if customer buys product #123 or #456
- **Minimum Order**: +100 pts on orders over €200
- **Multiplier**: 2× points during a campaign period
- **Flat Bonus**: +50 pts on every qualifying order

---

## 5. API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/webhook/cloudcart` | POST | CloudCart webhook receiver |
| `/admin` | GET | Dashboard UI |
| `/api/admin/stats` | GET | Overview stats |
| `/api/admin/customers` | GET | List customers (search, pagination) |
| `/api/admin/customers/:id/adjust` | POST | Manual points adjustment |
| `/api/admin/customers/:id/redeem` | POST | Manual redemption |
| `/api/admin/customers/:id/sync` | POST | Force sync to CloudCart |
| `/api/admin/tiers` | GET/POST/PATCH/DELETE | Manage tiers |
| `/api/admin/rules` | GET/POST/PATCH/DELETE | Manage bonus rules |
| `/api/admin/settings` | GET/PATCH | App settings |
| `/api/admin/transactions` | GET | Points transaction log |
| `/api/setup` | POST | Run initial setup |
| `/api/setup/sync-existing` | POST | Import CloudCart customers |

---

## 6. Default Configuration

| Setting | Default | Meaning |
|---|---|---|
| `points_per_eur` | 2 | 2 points per €1 spent |
| `points_to_eur_rate` | 100 | 100 points = €1 discount |
| `min_order_eur` | 0 | No minimum order |
| `trigger_status` | paid | Award points when order is `paid` |
| `promo_code_prefix` | LOYALTY | Codes: LOYALTY1, LOYALTY2, ... |

### Default Tiers
| Tier | Min Points | Spend to reach (at 2pts/€) |
|---|---|---|
| Bronze | 1,000 pts | €500 |
| Silver | 2,000 pts | €1,000 |
| Gold | 3,000 pts | €1,500 |
| Platinum | 4,000 pts | €2,000 |
| Diamond | 5,000 pts | €2,500 |
