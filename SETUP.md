# Loyalty Program — Setup Guide (Multi-Tenant)

## Stack
- **Runtime**: Cloudflare Workers (Hono framework)
- **Database**: Supabase (PostgreSQL + pgcrypto)
- **Deploy**: `wrangler deploy`

---

## 1. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run these files in order:
   - `supabase/schema.sql` — creates all tables, indexes, and the auto-defaults trigger
   - `supabase/functions.sql` — creates password hashing/verification functions
3. Copy your **Project URL** and **service_role key** (Settings → API)

---

## 2. Cloudflare Workers

### First-time setup
```bash
npm install
npx wrangler login
```

### Set secrets
```bash
npx wrangler secret put SUPABASE_URL
# value: https://xxxx.supabase.co

npx wrangler secret put SUPABASE_SERVICE_KEY
# value: eyJ... (service_role key)

npx wrangler secret put SUPER_ADMIN_KEY
# value: a strong random string for onboarding merchants
```

### Deploy
```bash
npm run deploy
```

---

## 3. Onboard a Merchant

```bash
curl -X POST https://loyalty-program.YOUR.workers.dev/api/super/merchants \
  -H "X-Super-Admin-Key: YOUR_SUPER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "mystore",
    "store_name": "My Store",
    "cloudcart_base_url": "https://mystore.cloudcart.net/api/v2",
    "cloudcart_api_key": "STORE_API_KEY",
    "admin_email": "admin@mystore.com",
    "admin_password": "secure-password"
  }'
```

This automatically:
- Creates the merchant record
- Generates a unique webhook secret
- Creates default settings (2 pts/€1, 100 pts = €1 discount)
- Creates default tiers (Bronze → Diamond)
- Creates default reward types (flat discount, free shipping, 10% off)

---

## 4. Merchant First Login

1. Go to `/admin` and enter the store slug + password
2. Click **Run Setup** — creates CloudCart customer groups + webhooks
3. Click **Sync Customers** — imports existing CloudCart customers
4. Configure reward types, bonus rules, and settings as needed

---

## 5. How It Works

### Points earn flow
1. Customer places an order on the CloudCart store
2. When order status matches trigger (default: `paid`), CloudCart fires a webhook
3. Worker receives at `POST /webhook/{slug}/cloudcart`, validates the secret
4. Calculates points: `floor(order_total_EUR × points_per_EUR)` + bonus rules
5. Updates Supabase: balance, lifetime points, tier, transaction log
6. Creates/updates personal promo code on CloudCart (discount-codes-pro)
7. Updates customer note + tier group on CloudCart

### Discount types
Merchants configure **Reward Types** in the dashboard:
- **Flat amount**: €X off (default, auto-applied based on points)
- **Percentage**: X% off
- **Free shipping**: at a points threshold
- **Product/Category/Vendor specific**: targeted discounts
- **Order threshold**: discount when order exceeds amount

### Multi-tenant isolation
- Every database query is scoped by `merchant_id`
- Each merchant has unique webhook URL, API credentials, and login
- Webhook secrets are per-merchant
- CloudCart API calls use per-merchant API keys
