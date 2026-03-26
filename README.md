# CloudCart Loyalty Program

A fully serverless loyalty points CRM for CloudCart stores. Built with **Hono** on **Cloudflare Workers**, backed by **Supabase** (PostgreSQL).

**Live admin dashboard:** https://loyalty-program.e-kurtisi.workers.dev/admin
**Store:** smokezone.cloudcart.net

---

## How It Works

```
Customer places order
       │
       ▼
CloudCart fires webhook (order.updated / order.created)
       │
       ▼
Loyalty Worker receives event
       │
       ├─ Calculates points  (order total × points_per_eur + bonus rules)
       ├─ Updates Supabase   (balance, tier, transaction log)
       ├─ Updates CloudCart customer note   (visible in admin panel)
       ├─ Updates CloudCart customer group  (Bronze / Silver / Gold / …)
       └─ Creates or updates personal promo code (e.g. LOYALTY3 = €12 off)
```

### What the customer sees
- Their personal promo code (e.g. `LOYALTY3`) in their store profile
- The code has a live EUR discount value based on their current points balance
- They enter it at checkout like a normal coupon → discount applied automatically

### What the admin sees (CloudCart customer profile → Note field)
```
🎯 LOYALTY POINTS
Points: 1,250
Tier: Silver
Promo code: LOYALTY3 (€12 discount)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono v4 |
| Language | TypeScript |
| Database | Supabase (PostgreSQL) |
| Deploy | `wrangler deploy` |
| Admin UI | Alpine.js + Tailwind CSS (CDN, no build step) |

---

## Project Structure

```
loyalty-program/
├── src/
│   ├── index.ts              # App entry point — routes + basic-auth middleware
│   ├── types.ts              # TypeScript types (Env bindings, DB shapes, CC API shapes)
│   ├── lib/
│   │   ├── cloudcart.ts      # CloudCart API v2 client (customers, groups, discount codes, webhooks)
│   │   ├── supabase.ts       # Supabase client factory + settings loader
│   │   └── points.ts         # Points engine: calculate, award, tier lookup, promo code upsert
│   ├── routes/
│   │   ├── webhook.ts        # POST /webhook/cloudcart — handles order events
│   │   ├── admin.ts          # /api/admin/* — customers, tiers, rules, settings, stats
│   │   └── setup.ts          # /api/setup — one-time setup + customer import
│   └── ui/
│       └── dashboard.ts      # Admin SPA (full HTML string served from the Worker)
├── supabase/
│   └── schema.sql            # Run once in Supabase SQL editor to create all tables
├── wrangler.toml             # Cloudflare Workers config
├── package.json
└── tsconfig.json
```

---

## Database Schema (Supabase)

| Table | Purpose |
|---|---|
| `settings` | Key/value config (points rate, trigger status, etc.) |
| `tiers` | Tier definitions (Bronze → Diamond) with CloudCart group IDs |
| `loyalty_customers` | One row per customer — points balance, tier, promo code |
| `points_transactions` | Full audit log of every earn / redeem / adjust |
| `bonus_rules` | Configurable bonus rules (hero products, multipliers, etc.) |
| `processed_orders` | Idempotency table — prevents double-awarding points |
| `webhook_logs` | Raw CloudCart webhook payloads for debugging |

---

## API Reference

All `/api/admin/*` and `/api/setup` endpoints require **Basic Auth** (`admin` / your password).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `GET` | `/admin` | Admin dashboard UI |
| `POST` | `/webhook/cloudcart` | CloudCart webhook receiver |
| `GET` | `/webhook/cloudcart/logs` | Last 20 raw webhook payloads (debug) |
| `GET` | `/api/admin/stats` | Overview stats |
| `GET` | `/api/admin/customers` | List customers (`?search=&page=&size=`) |
| `GET` | `/api/admin/customers/:id` | Single customer |
| `POST` | `/api/admin/customers/:id/adjust` | Manual points adjustment |
| `POST` | `/api/admin/customers/:id/redeem` | Manual redemption |
| `POST` | `/api/admin/customers/:id/sync` | Force re-sync to CloudCart |
| `GET/POST` | `/api/admin/tiers` | List / create tiers |
| `PATCH/DELETE` | `/api/admin/tiers/:id` | Update / delete tier |
| `GET/POST` | `/api/admin/rules` | List / create bonus rules |
| `PATCH/DELETE` | `/api/admin/rules/:id` | Update / delete bonus rule |
| `GET/PATCH` | `/api/admin/settings` | Read / update global settings |
| `GET` | `/api/admin/transactions` | Points transaction log |
| `POST` | `/api/setup` | One-time setup (creates CC groups + webhooks) |
| `POST` | `/api/setup/sync-existing` | Import all existing CloudCart customers |

---

## Configuration (Settings)

Managed via the admin dashboard → **Settings** tab, or `PATCH /api/admin/settings`.

| Key | Default | Description |
|---|---|---|
| `points_per_eur` | `2` | Points earned per €1 spent |
| `points_to_eur_rate` | `100` | Points needed for €1 discount on promo code |
| `min_order_eur` | `0` | Minimum order value (€) to earn points |
| `trigger_status` | `paid` | Order status that triggers point award |
| `promo_code_prefix` | `LOYALTY` | Prefix for personal codes (`LOYALTY3`, `LOYALTY42`, …) |
| `store_name` | `Smokezone` | Displayed in dashboard header |

### Default Tiers

| Tier | Min Points | Equivalent spend (at 2 pts/€) |
|---|---|---|
| Bronze | 1,000 | €500 |
| Silver | 2,000 | €1,000 |
| Gold | 3,000 | €1,500 |
| Platinum | 4,000 | €2,000 |
| Diamond | 5,000 | €2,500 |

---

## Bonus Rules

Configure in the **⚡ Bonus Rules** tab. Four types:

| Type | Effect | Example config |
|---|---|---|
| `product_ids` | Extra points if order contains specific products | `{"product_ids": [123, 456]}` |
| `minimum_order` | Flat bonus on orders above a threshold | `{"min_order_eur": 200}` |
| `multiplier` | Multiply base points by a factor | multiplier = `2.0` |
| `flat_bonus` | Add fixed points to every qualifying order | extra_points = `50` |

Rules support optional `valid_from` / `valid_until` dates for time-limited campaigns.

---

## Local Development

```bash
npm install
npx wrangler dev        # runs locally at http://localhost:8787
```

For local dev, create a `.dev.vars` file (never commit this):
```env
CLOUDCART_API_KEY=your_key
CLOUDCART_BASE_URL=https://smokezone.cloudcart.net/api/v2
SUPABASE_URL=https://sguuwljmkmehudxhxkvl.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
WEBHOOK_SECRET=your_webhook_secret
```

---

## Deployment

```bash
npm run deploy          # deploys to Cloudflare Workers
```

Secrets are managed via Wrangler (stored in Cloudflare, never in the repo):
```bash
echo "value" | npx wrangler secret put SECRET_NAME
```

Required secrets: `CLOUDCART_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASSWORD`, `WEBHOOK_SECRET`

The `ADMIN_USERNAME` var is set in `wrangler.toml` (non-sensitive, defaults to `admin`).

---

## First-Time Setup (new store / new deployment)

1. Run `supabase/schema.sql` in Supabase SQL editor
2. Set all secrets via `wrangler secret put`
3. `npm run deploy`
4. `POST /api/setup` — creates CloudCart tier groups + registers webhooks
5. `POST /api/setup/sync-existing` — imports existing customers

---

## Cloudflare Notes

- **Rate limit:** CloudCart API allows 50 req/min (plan default). Upgradeable in CloudCart admin → Settings → API Keys.
- **Webhook secret:** CloudCart sends `X-Loyalty-Secret` header on every webhook. Value must match the `WEBHOOK_SECRET` env var.
- **Idempotency:** Each order is recorded in `processed_orders` — safe to receive the same webhook multiple times.
- **Safety cap:** Orders over €50,000 are ignored (likely bad data) and logged.

---

## CloudCart API Notes

- All monetary values in the CloudCart API are in **cents** (integer). `price_total: 15000` = €150.00
- Discount code `value` is in **EUR** (integer). `value: 12` = €12 off.
- Discount code `code` must be **alphanumeric only** (no hyphens/spaces). Format: `LOYALTY{customer_id}`
- Webhook events available: `order.created`, `order.updated`
