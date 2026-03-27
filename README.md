# CloudCart Loyalty Program (Multi-Tenant)

A production-ready, multi-tenant loyalty points CRM for CloudCart stores. Every merchant gets their own isolated dashboard, webhook endpoint, and configuration. Built with **Hono** on **Cloudflare Workers**, backed by **Supabase** (PostgreSQL).

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │   Cloudflare Workers (Hono)   │
                    │   loyalty-program.workers.dev │
                    └─────────────┬────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
    /webhook/:slug/        /admin/:slug            /api/m/:slug/
    cloudcart              (Dashboard)             admin/*
         │                        │                        │
   Per-merchant             Login → Token          Merchant-scoped
   webhook secret           Bearer auth            CRUD endpoints
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                    ┌─────────────▼────────────────┐
                    │     Supabase (PostgreSQL)     │
                    │  All tables scoped by         │
                    │  merchant_id                  │
                    └──────────────────────────────┘
```

## How It Works

1. **Merchant onboarded** via super-admin API → gets a unique `slug`
2. CloudCart webhook fires on order events → `POST /webhook/{slug}/cloudcart`
3. Worker validates secret, calculates points, updates Supabase
4. Syncs to CloudCart: customer note, tier group, personal promo code
5. Merchant manages everything via dashboard at `/admin/{slug}`

---

## Discount Types (via CloudCart API)

The system supports multiple discount types through the CloudCart `discount-codes-pro` API:

| Type | CloudCart Condition | Example |
|---|---|---|
| **Flat amount** | `type: flat, setting: all` | €10 off entire order |
| **Percentage** | `type: percent, setting: all` | 10% off entire order |
| **Free shipping** | `type: shipping, setting: all` | Free shipping |
| **Product-specific flat** | `type: flat, setting: product` | €5 off specific products |
| **Category discount** | `type: percent, setting: category` | 15% off a category |
| **Vendor/brand discount** | `type: flat, setting: vendor` | €10 off a brand |
| **Order threshold** | `type: flat, setting: order_over` | €20 off orders over €100 |

Merchants configure these as **Reward Types** in the dashboard. The default auto-applied reward converts points to a flat EUR discount. Additional rewards (free shipping at 500 pts, 10% off at 1000 pts) are created automatically for new merchants.

### Auto-Reward Vouchers

When a customer's points balance reaches a reward's threshold (`min_points_cost`), a unique voucher code is automatically created on CloudCart as a `discount-codes-pro` entry. These are tracked in the `customer_rewards` table and visible in the dashboard under each customer's **Vouchers** button and the **Issued Vouchers** section of the Rewards tab.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono v4 |
| Language | TypeScript |
| Database | Supabase (PostgreSQL + pgcrypto) |
| Deploy | `wrangler deploy` |
| Admin UI | Alpine.js + Tailwind CSS (CDN) |

---

## Project Structure

```
src/
├── index.ts              # Entry point — auth middleware, routing, super-admin API
├── types.ts              # TypeScript types (multi-tenant)
├── lib/
│   ├── cloudcart.ts      # CloudCart API v2 client (per-merchant, auto-appends /api/v2)
│   ├── supabase.ts       # Supabase client + merchant/settings loaders
│   └── points.ts         # Points engine, reward conditions, promo code sync
├── routes/
│   ├── webhook.ts        # POST /webhook/:slug/cloudcart
│   ├── admin.ts          # /api/m/:slug/admin/* — merchant-scoped CRUD
│   ├── setup.ts          # /api/m/:slug/setup — per-merchant setup wizard
│   └── customer.ts       # /c/:slug/* — public customer-facing API + pages
└── ui/
    ├── dashboard.ts      # Login page + merchant admin SPA (Alpine.js v3)
    └── customer.ts       # Customer loyalty page + embeddable widget

supabase/
├── schema.sql            # Multi-tenant schema (drop + recreate, with triggers)
└── functions.sql         # pgcrypto password hashing functions
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `merchants` | One row per CloudCart store (credentials, config) |
| `settings` | Key/value config per merchant |
| `tiers` | Tier definitions per merchant |
| `reward_types` | Configurable discount types per merchant |
| `loyalty_customers` | Customer points/tiers scoped by merchant |
| `points_transactions` | Full audit log per merchant |
| `bonus_rules` | Bonus point rules per merchant |
| `customer_rewards` | Issued voucher codes per customer per reward type |
| `processed_orders` | Idempotency per merchant |
| `webhook_logs` | Raw webhook payloads per merchant |

---

## Deployment

### 1. Supabase Setup

```bash
# Run in Supabase SQL editor (in order):
# 1. supabase/schema.sql
# 2. supabase/functions.sql
```

### 2. Cloudflare Workers

```bash
npm install
npx wrangler login

# Set secrets
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put SUPER_ADMIN_KEY

# Deploy
npm run deploy
```

### 3. Onboard a Merchant

```bash
curl -X POST https://loyalty-program.YOUR.workers.dev/api/super/merchants \
  -H "X-Super-Admin-Key: YOUR_SUPER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "smokezone",
    "store_name": "Smokezone",
    "cloudcart_base_url": "https://smokezone.cloudcart.net",
    "cloudcart_api_key": "YOUR_CLOUDCART_KEY",
    "admin_email": "admin@smokezone.com",
    "admin_password": "secure-password"
  }'
```

### 4. Merchant First Login

1. Go to `https://loyalty-program.YOUR.workers.dev/admin`
2. Enter slug + password
3. Click **Run Setup** to create CloudCart groups + webhooks
4. Click **Sync Customers** to import existing customers

---

## API Reference

### Public

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/webhook/:slug/cloudcart` | Merchant webhook receiver |
| `POST` | `/api/login` | Merchant login (returns token) |
| `GET` | `/admin` | Login page |
| `GET` | `/admin/:slug` | Merchant dashboard |

### Customer-Facing (public, HMAC token auth via query params)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/c/:slug/api/me?email=X&token=Y` | Customer loyalty data (JSON) |
| `GET` | `/c/:slug/page?email=X&token=Y` | Full loyalty page (BestSecret-style) |
| `GET` | `/c/:slug/widget?email=X&token=Y` | Compact embeddable widget |
| `GET` | `/c/:slug/console.js` | Chrome console injection script |

### Merchant API (Bearer token required)

| Method | Endpoint | Description |
|---|---|---|
| `GET/PATCH` | `/api/m/:slug/admin/settings` | Settings |
| `GET/POST` | `/api/m/:slug/admin/tiers` | Tiers |
| `PATCH/DELETE` | `/api/m/:slug/admin/tiers/:id` | Tier ops |
| `GET/POST` | `/api/m/:slug/admin/rewards` | Reward types |
| `PATCH/DELETE` | `/api/m/:slug/admin/rewards/:id` | Reward ops |
| `GET/POST` | `/api/m/:slug/admin/rules` | Bonus rules |
| `PATCH/DELETE` | `/api/m/:slug/admin/rules/:id` | Rule ops |
| `GET` | `/api/m/:slug/admin/customers` | List customers |
| `POST` | `/api/m/:slug/admin/customers/:id/adjust` | Adjust points |
| `POST` | `/api/m/:slug/admin/customers/:id/redeem` | Redeem points |
| `POST` | `/api/m/:slug/admin/customers/:id/sync` | Sync orders + assign rewards |
| `GET` | `/api/m/:slug/admin/customers/:id/rewards` | Customer's issued vouchers |
| `GET` | `/api/m/:slug/admin/rewards/issued` | All issued vouchers |
| `GET` | `/api/m/:slug/admin/stats` | Stats overview |
| `GET` | `/api/m/:slug/admin/transactions` | Transaction log |
| `POST` | `/api/m/:slug/setup` | Run initial setup |
| `POST` | `/api/m/:slug/setup/sync-existing` | Import customers + process orders |

### Super-Admin (X-Super-Admin-Key header required)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/super/merchants` | Onboard new merchant |
| `GET` | `/api/super/merchants` | List all merchants |

---

## Live Deployment

| Resource | URL |
|---|---|
| Worker | `https://loyalty-program.e-kurtisi.workers.dev` |
| Admin login | `https://loyalty-program.e-kurtisi.workers.dev/admin` |
| Smokezone dashboard | `https://loyalty-program.e-kurtisi.workers.dev/admin/smokezone` |
| Smokezone webhook | `https://loyalty-program.e-kurtisi.workers.dev/webhook/smokezone/cloudcart` |

### Key Notes
- **CloudCart base URL**: Just the domain (e.g. `https://smokezone.cloudcart.net`). The code auto-appends `/api/v2`.
- **Alpine.js**: v3 is used for the dashboard (login uses `x-data` component pattern, not the v2 `__x.$data` API).
- **Schema migration**: `schema.sql` drops all tables with CASCADE before recreating — safe to re-run but destructive. The `customer_rewards` table must also exist (included in `schema.sql`).
- **Safety cap**: Webhook ignores orders over €500,000 as a fraud safeguard.
