-- ============================================================
-- Loyalty Program — Multi-Tenant Supabase Schema
-- Run this in your Supabase SQL editor (replaces previous schema)
-- ============================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Merchants (one row per CloudCart store)
-- ============================================================
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,              -- URL-safe identifier, e.g. "smokezone"
  store_name TEXT NOT NULL,
  cloudcart_base_url TEXT NOT NULL,       -- e.g. https://smokezone.cloudcart.net/api/v2
  cloudcart_api_key TEXT NOT NULL,        -- encrypted at rest by Supabase
  admin_email TEXT NOT NULL,
  admin_password_hash TEXT NOT NULL,      -- bcrypt hash
  webhook_secret TEXT NOT NULL,           -- per-merchant webhook validation
  loyalty_container_id INTEGER,           -- CloudCart discount container (code-pro)
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Settings (key/value config per merchant)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (merchant_id, key)
);

-- ============================================================
-- Tiers (configurable loyalty tiers per merchant)
-- ============================================================
CREATE TABLE IF NOT EXISTS tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_points INTEGER NOT NULL DEFAULT 0,
  cloudcart_group_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Reward types (configurable discount types per merchant)
-- ============================================================
CREATE TABLE IF NOT EXISTS reward_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                     -- e.g. "Points Discount", "Free Shipping", "10% Off"
  description TEXT,
  discount_method TEXT NOT NULL CHECK (discount_method IN ('flat', 'percent', 'shipping')),
  discount_target TEXT NOT NULL DEFAULT 'all'
    CHECK (discount_target IN ('all', 'product', 'category', 'vendor', 'order_over', 'selection')),
  discount_value INTEGER NOT NULL DEFAULT 0,  -- cents for flat, hundredths for percent (1000 = 10%)
  min_points_cost INTEGER NOT NULL DEFAULT 0, -- points required to unlock this reward
  order_over_cents INTEGER,               -- min order amount in cents (for order_over target)
  product_ids INTEGER[] DEFAULT '{}',
  category_ids INTEGER[] DEFAULT '{}',
  vendor_ids INTEGER[] DEFAULT '{}',
  auto_apply BOOLEAN NOT NULL DEFAULT FALSE,  -- if true, auto-applied via points balance
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Customers (synced from CloudCart, scoped per merchant)
-- ============================================================
CREATE TABLE IF NOT EXISTS loyalty_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  cloudcart_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  points_balance INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  tier_id UUID REFERENCES tiers(id) ON DELETE SET NULL,
  promo_code TEXT,
  promo_code_cloudcart_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (merchant_id, cloudcart_id)
);

-- ============================================================
-- Points transactions (full audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS points_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE,
  cloudcart_order_id INTEGER,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust', 'expire')),
  points INTEGER NOT NULL,
  order_value_cents INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Bonus rules (hero products, multipliers, minimum-order bonuses)
-- ============================================================
CREATE TABLE IF NOT EXISTS bonus_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('product_ids', 'minimum_order', 'multiplier', 'flat_bonus')),
  config JSONB NOT NULL DEFAULT '{}',
  extra_points INTEGER DEFAULT 0,
  multiplier DECIMAL(4,2) DEFAULT 1.0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Processed orders (idempotency per merchant)
-- ============================================================
CREATE TABLE IF NOT EXISTS processed_orders (
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  cloudcart_order_id INTEGER NOT NULL,
  customer_id UUID REFERENCES loyalty_customers(id) ON DELETE SET NULL,
  points_awarded INTEGER NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (merchant_id, cloudcart_order_id)
);

-- ============================================================
-- Webhook logs (debugging)
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  raw_payload JSONB,
  headers JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_merchants_slug ON merchants(slug);
CREATE INDEX IF NOT EXISTS idx_settings_merchant ON settings(merchant_id);
CREATE INDEX IF NOT EXISTS idx_tiers_merchant ON tiers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_reward_types_merchant ON reward_types(merchant_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_customers_merchant ON loyalty_customers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_customers_cloudcart ON loyalty_customers(merchant_id, cloudcart_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_customers_email ON loyalty_customers(merchant_id, email);
CREATE INDEX IF NOT EXISTS idx_points_transactions_customer ON points_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_merchant ON points_transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_bonus_rules_merchant_active ON bonus_rules(merchant_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_processed_orders_merchant ON processed_orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant ON webhook_logs(merchant_id);

-- ============================================================
-- Helper: insert default settings for a new merchant
-- ============================================================
CREATE OR REPLACE FUNCTION insert_default_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO settings (merchant_id, key, value) VALUES
    (NEW.id, 'points_per_eur',     '2'),
    (NEW.id, 'min_order_eur',      '0'),
    (NEW.id, 'trigger_status',     'paid'),
    (NEW.id, 'points_to_eur_rate', '100'),
    (NEW.id, 'promo_code_prefix',  'LOYALTY');
  INSERT INTO tiers (merchant_id, name, min_points, sort_order) VALUES
    (NEW.id, 'Bronze',   1000, 1),
    (NEW.id, 'Silver',   2000, 2),
    (NEW.id, 'Gold',     3000, 3),
    (NEW.id, 'Platinum', 4000, 4),
    (NEW.id, 'Diamond',  5000, 5);
  INSERT INTO reward_types (merchant_id, name, description, discount_method, discount_target, discount_value, min_points_cost, auto_apply, sort_order) VALUES
    (NEW.id, 'Points Discount',  'Automatic flat discount based on points balance', 'flat',     'all', 0, 0, TRUE,  1),
    (NEW.id, 'Free Shipping',    'Free shipping reward claimable at 500 points',    'shipping', 'all', 0, 500, FALSE, 2),
    (NEW.id, '10% Off Order',    '10% off entire order at 1000 points',             'percent',  'all', 1000, 1000, FALSE, 3);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_merchant_defaults ON merchants;
CREATE TRIGGER trg_merchant_defaults
  AFTER INSERT ON merchants
  FOR EACH ROW EXECUTE FUNCTION insert_default_settings();
