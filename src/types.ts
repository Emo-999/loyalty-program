// ============================================================
// Cloudflare Worker environment bindings
// ============================================================
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPER_ADMIN_KEY: string;
}

// ============================================================
// Merchant (tenant)
// ============================================================
export interface DbMerchant {
  id: string;
  slug: string;
  store_name: string;
  cloudcart_base_url: string;
  cloudcart_api_key: string;
  cloudcart_pat_token: string | null;
  admin_email: string;
  admin_password_hash: string;
  webhook_secret: string;
  loyalty_container_id: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Settings (per-merchant key/value)
// ============================================================
export interface DbSettings {
  points_per_eur: number;
  min_order_eur: number;
  trigger_status: string;
  points_to_eur_rate: number;
  promo_code_prefix: string;
}

// ============================================================
// Tiers
// ============================================================
export interface DbTier {
  id: string;
  merchant_id: string;
  name: string;
  min_points: number;
  cloudcart_group_id: number | null;
  sort_order: number;
  created_at: string;
}

// ============================================================
// Reward types (discount flavours a merchant offers)
// ============================================================
export type DiscountMethod = 'flat' | 'percent' | 'shipping';
export type DiscountTarget = 'all' | 'product' | 'category' | 'vendor' | 'order_over' | 'selection';

export interface DbRewardType {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  discount_method: DiscountMethod;
  discount_target: DiscountTarget;
  discount_value: number;
  min_points_cost: number;
  order_over_cents: number | null;
  product_ids: number[];
  category_ids: number[];
  vendor_ids: number[];
  auto_apply: boolean;
  active: boolean;
  sort_order: number;
  created_at: string;
}

// ============================================================
// Customers
// ============================================================
export interface DbCustomer {
  id: string;
  merchant_id: string;
  cloudcart_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  points_balance: number;
  lifetime_points: number;
  tier_id: string | null;
  promo_code: string | null;
  promo_code_cloudcart_id: number | null;
  created_at: string;
  updated_at: string;
  tiers?: DbTier;
}

// ============================================================
// Customer rewards (issued voucher codes)
// ============================================================
export interface DbCustomerReward {
  id: string;
  merchant_id: string;
  customer_id: string;
  reward_type_id: string;
  voucher_code: string;
  cloudcart_pro_code_id: number | null;
  status: 'active' | 'redeemed' | 'expired';
  created_at: string;
  reward_types?: DbRewardType;
}

// ============================================================
// Transactions
// ============================================================
export interface DbTransaction {
  id: string;
  merchant_id: string;
  customer_id: string;
  cloudcart_order_id: number | null;
  type: 'earn' | 'redeem' | 'adjust' | 'expire';
  points: number;
  order_value_cents: number | null;
  description: string | null;
  created_at: string;
}

// ============================================================
// Bonus rules
// ============================================================
export interface DbBonusRule {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  type: 'product_ids' | 'minimum_order' | 'multiplier' | 'flat_bonus';
  config: Record<string, unknown>;
  extra_points: number;
  multiplier: number;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
}

// ============================================================
// CloudCart API shapes
// ============================================================
export interface CCCustomer {
  id: string;
  attributes: {
    first_name: string;
    last_name: string;
    email: string;
    group_id: number;
    note: string | null;
    income: number;
    completed_orders: number;
    orders_total_price: number;
    last_order_date: string | null;
    date_added: string;
    updated_at: string;
  };
}

export interface CCOrder {
  id: string;
  attributes: {
    customer_id: number;
    customer_email: string;
    customer_first_name: string;
    customer_last_name: string;
    price_total: number;
    currency: string;
    status: string;
    status_fulfillment: string;
    date_added: string;
    updated_at: string;
  };
}

export interface CCCustomerGroup {
  id: string;
  attributes: { name: string };
}

export interface CCDiscountCode {
  id: string;
  attributes: {
    code: string;
    value: number;
    active: number;
    created_at: string;
    updated_at: string;
  };
}

export interface CCProCondition {
  type: 'flat' | 'percent' | 'shipping';
  setting: 'all' | 'product' | 'category' | 'vendor' | 'category_vendor' | 'order_over' | 'selection';
  value: number;
  order_over?: number;
  product?: number[];
  category?: number[];
  vendor?: number[];
}

export interface CCProCode {
  id: string;
  attributes: {
    discount_id: number;
    code: string;
    name: string | null;
    active: number;
    uses: number;
    max_uses: number | null;
    maxused_user: number | null;
    only_customer: number;
    date_start: string;
    date_end: string | null;
    conditions: CCProCondition[];
    created_at: string;
    updated_at: string;
  };
}

export interface CCDiscount {
  id: string;
  attributes: {
    name: string;
    discount_type: string;
    active: string;
    date_start: string;
    date_end: string | null;
  };
}

export interface CCWebhook {
  id: string;
  attributes: {
    url: string;
    event: string;
    active: number;
    created_at: string;
  };
}

// ============================================================
// Webhook payload from CloudCart
// ============================================================
export interface CCWebhookPayload {
  data: {
    type: string;
    id: string;
    attributes: Record<string, unknown>;
  };
}

// ============================================================
// Hono context variables (set by middleware)
// ============================================================
export interface AppVariables {
  merchant: DbMerchant;
}
