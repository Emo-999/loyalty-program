import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env, DbSettings } from '../types';

export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

export async function loadSettings(db: SupabaseClient): Promise<DbSettings> {
  const { data, error } = await db.from('settings').select('key, value');
  if (error) throw new Error(`loadSettings: ${error.message}`);

  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key] = row.value;

  return {
    points_per_eur: Number(map['points_per_eur'] ?? 2),
    min_order_eur: Number(map['min_order_eur'] ?? 0),
    trigger_status: map['trigger_status'] ?? 'paid',
    points_to_eur_rate: Number(map['points_to_eur_rate'] ?? 100),
    promo_code_prefix: map['promo_code_prefix'] ?? 'LOYALTY',
    store_name: map['store_name'] ?? 'Store',
    loyalty_container_id: map['loyalty_container_id'] ? Number(map['loyalty_container_id']) : null,
  };
}

export async function saveSetting(
  db: SupabaseClient,
  key: string,
  value: string,
): Promise<void> {
  const { error } = await db
    .from('settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`saveSetting(${key}): ${error.message}`);
}
