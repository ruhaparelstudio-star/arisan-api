import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';

const FONNTE_TOKEN = process.env.FONNTE_TOKEN!;
const FONNTE_TIMEOUT = parseInt(process.env.FONNTE_TIMEOUT_MS ?? '3000');

// Kirim WA ke user berdasarkan userId — tidak pernah throw
export async function sendWA(userId: string, message: string): Promise<void> {
  try {
    const { data: user } = await supabase.from('users').select('phone').eq('id', userId).single();

    if (!user?.phone) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FONNTE_TIMEOUT);

    try {
      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { Authorization: FONNTE_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: user.phone, message }),
        signal: controller.signal,
      });
      if (!res.ok) logger.error('Fonnte WA failed', { userId, status: res.status });
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError' ? 'Timeout' : String(err);
      logger.error('Fonnte WA error', { userId, error: msg });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.error('sendWA failed', { userId, error: String(err) });
  }
}
