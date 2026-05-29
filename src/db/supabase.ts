import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_KEY wajib diisi di .env');
  }
  return createClient(url, key);
}

export const supabase = getSupabaseClient();
