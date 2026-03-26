// ============================================================
// Cloudflare Worker environment bindings
// ============================================================
export interface Env {
  CLOUDCART_API_KEY: string;
  CLOUDCART_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD: string;
  WEBHOOK_SECRET: string;
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
    income: number;               // cents
    completed_orders: number;
    orders_total_price: number;   // cents
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
    price_total: number;          // cents
    currency: string;
    status: string;               // pending | paid | completed | ...
    status_fulfillment: string;   // not_fulfilled | fulfilled
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
    value: number;   // EUR (not cents)
    active: number;
    created_at: string;
    updated_at: string;
  };
}

// discount-codes-pro condition object
export interface CCProCondition {
  type: 'flat' | 'percent' | 'shipping';
  setting: 'all' | 'product' | 'category' | 'vendor' | 'category_vendor' | 'order_over' | 'selection';
  value: number;        // cents for flat (500 = €5), hundredths for percent (1000 = 10%)
  order_over?: number;  // cents threshold
  product?: number[];
  category?: number[];
  vendor?: number[];
}

// Individual discount-codes-pro entry
export interface CCProCode {
  id: string;
  attributes: {
    discount_id: number;
    code: string;
    name: string | null;
    active: number;
    uses: number;                // redemption counter — key for auto-detection
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

// Discount container (type: code-pro)
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
// Database row shapes (Supabase)
// ============================================================
export interface DbTier {
  id: string;
  name: string;
  min_points: number;
  cloudcart_group_id: number | null;
  sort_order: number;
  created_at: string;
}

export interface DbCustomer {
  id: string;
  cloudcart_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  points_balance: number;
  tier_id: string | null;
  promo_code: string | null;
  promo_code_cloudcart_id: number | null;
  created_at: string;
  updated_at: string;
  // joined
  tiers?: DbTier;
}

export interface DbTransaction {
  id: string;
  customer_id: string;
  cloudcart_order_id: number | null;
  type: 'earn' | 'redeem' | 'adjust' | 'expire';
  points: number;
  order_value_cents: number | null;
  description: string | null;
  created_at: string;
}

export interface DbBonusRule {
  id: string;
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

export interface DbSettings {
  points_per_eur: number;
  min_order_eur: number;
  trigger_status: string;
  points_to_eur_rate: number;
  promo_code_prefix: string;
  store_name: string;
  loyalty_container_id: number | null;  // CloudCart discount container (code-pro type)
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
