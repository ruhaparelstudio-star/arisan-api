import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_KEY wajib diisi di .env');
  }
  return createClient(url, key, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: WebSocket as any },
  });
}

export const supabase = getSupabaseClient();
