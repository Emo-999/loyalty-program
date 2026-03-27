import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env, DbSettings, DbMerchant } from '../types';

export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

const MERCHANT_SAFE_COLUMNS = 'id, slug, store_name, cloudcart_base_url, cloudcart_api_key, cloudcart_pat_token, admin_email, webhook_secret, loyalty_container_id, active, created_at, updated_at';

export async function getMerchantBySlug(
  db: SupabaseClient,
  slug: string,
): Promise<DbMerchant | null> {
  const { data } = await db
    .from('merchants')
    .select(MERCHANT_SAFE_COLUMNS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  return data;
}

export async function getMerchantById(
  db: SupabaseClient,
  id: string,
): Promise<DbMerchant | null> {
  const { data } = await db
    .from('merchants')
    .select(MERCHANT_SAFE_COLUMNS)
    .eq('id', id)
    .eq('active', true)
    .maybeSingle();
  return data;
}

export async function loadSettings(
  db: SupabaseClient,
  merchantId: string,
): Promise<DbSettings> {
  const { data, error } = await db
    .from('settings')
    .select('key, value')
    .eq('merchant_id', merchantId);
  if (error) throw new Error(`loadSettings: ${error.message}`);

  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;

  return {
    points_per_eur: Number(map['points_per_eur'] ?? 2),
    min_order_eur: Number(map['min_order_eur'] ?? 0),
    trigger_status: map['trigger_status'] ?? 'paid',
    points_to_eur_rate: Number(map['points_to_eur_rate'] ?? 100),
    promo_code_prefix: map['promo_code_prefix'] ?? 'LOYALTY',
  };
}

export async function saveSetting(
  db: SupabaseClient,
  merchantId: string,
  key: string,
  value: string,
): Promise<void> {
  const { error } = await db.from('settings').upsert(
    { merchant_id: merchantId, key, value, updated_at: new Date().toISOString() },
    { onConflict: 'merchant_id,key' },
  );
  if (error) throw new Error(`saveSetting(${key}): ${error.message}`);
}
