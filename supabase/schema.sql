-- ============================================================
-- Loyalty Program — Supabase Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Settings (key/value config store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tiers (configurable loyalty tiers)
CREATE TABLE IF NOT EXISTS tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  min_points INTEGER NOT NULL DEFAULT 0,
  cloudcart_group_id INTEGER,         -- CloudCart customer-group ID (set during setup)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers (synced from CloudCart, source of truth for points)
CREATE TABLE IF NOT EXISTS loyalty_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cloudcart_id INTEGER UNIQUE NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  points_balance INTEGER NOT NULL DEFAULT 0,
  tier_id UUID REFERENCES tiers(id),
  promo_code TEXT,                     -- e.g. LOYALTY3
  promo_code_cloudcart_id INTEGER,     -- CloudCart discount-code ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Points transactions (full audit trail)
CREATE TABLE IF NOT EXISTS points_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES loyalty_customers(id) ON DELETE CASCADE,
  cloudcart_order_id INTEGER,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust', 'expire')),
  points INTEGER NOT NULL,             -- positive = earn, negative = spend/expire
  order_value_cents INTEGER,           -- order value in cents when earned
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bonus rules (hero products, multipliers, minimum-order bonuses)
CREATE TABLE IF NOT EXISTS bonus_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('product_ids', 'minimum_order', 'multiplier', 'flat_bonus')),
  config JSONB NOT NULL DEFAULT '{}',  -- e.g. {"product_ids":[123,456]} or {"min_order_eur":100}
  extra_points INTEGER DEFAULT 0,      -- flat bonus
  multiplier DECIMAL(4,2) DEFAULT 1.0, -- e.g. 2.0 for double points
  active BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Processed orders (idempotency — prevents double-awarding points)
CREATE TABLE IF NOT EXISTS processed_orders (
  cloudcart_order_id INTEGER PRIMARY KEY,
  customer_id UUID REFERENCES loyalty_customers(id) ON DELETE SET NULL,
  points_awarded INTEGER NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Default data
-- ============================================================

INSERT INTO settings (key, value) VALUES
  ('points_per_eur',       '2'),       -- 2 points earned per €1 spent
  ('min_order_eur',        '0'),       -- minimum order value (€) to earn points
  ('trigger_status',       'paid'),    -- order status that triggers point award
  ('points_to_eur_rate',   '100'),     -- 100 points = €1 discount on promo code
  ('promo_code_prefix',    'LOYALTY'), -- prefix for personal promo codes
  ('store_name',           'Smokezone')
ON CONFLICT (key) DO NOTHING;

INSERT INTO tiers (name, min_points, sort_order) VALUES
  ('Bronze',   1000,  1),
  ('Silver',   2000,  2),
  ('Gold',     3000,  3),
  ('Platinum', 4000,  4),
  ('Diamond',  5000,  5)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_loyalty_customers_cloudcart_id ON loyalty_customers(cloudcart_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_customer_id ON points_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_points_transactions_order_id ON points_transactions(cloudcart_order_id);
CREATE INDEX IF NOT EXISTS idx_bonus_rules_active ON bonus_rules(active) WHERE active = TRUE;
