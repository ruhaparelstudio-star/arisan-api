import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { randomInt } from 'crypto';

const FONNTE_TOKEN = process.env.FONNTE_TOKEN!;
const FONNTE_TIMEOUT = parseInt(process.env.FONNTE_TIMEOUT_MS ?? '3000');
const OTP_TTL_MIN = 5;
const RATE_MAX = 5;
const RATE_WINDOW_HOURS = 1;

export function generateOTP(): string {
  return String(randomInt(100000, 999999));
}

export async function checkRateLimit(
  phone: string
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const { data } = await supabase.from('otp_rate_limit').select('*').eq('phone', phone).single();

  if (!data) {
    await supabase
      .from('otp_rate_limit')
      .insert({ phone, attempt_count: 1, window_start: new Date() });
    return { allowed: true };
  }

  const windowStart = new Date(data.window_start);
  const windowEnd = new Date(windowStart.getTime() + RATE_WINDOW_HOURS * 60 * 60 * 1000);
  const now = new Date();

  if (now > windowEnd) {
    await supabase
      .from('otp_rate_limit')
      .update({ attempt_count: 1, window_start: now })
      .eq('phone', phone);
    return { allowed: true };
  }

  if (data.attempt_count >= RATE_MAX) {
    return { allowed: false, retryAfterMs: windowEnd.getTime() - now.getTime() };
  }

  await supabase
    .from('otp_rate_limit')
    .update({ attempt_count: data.attempt_count + 1 })
    .eq('phone', phone);
  return { allowed: true };
}

export async function saveOTP(phone: string, code: string): Promise<void> {
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  await supabase.from('otp_codes').insert({ phone, code, expires_at: expiresAt });
}

export async function verifyOTP(
  phone: string,
  code: string
): Promise<{ valid: boolean; reason?: string }> {
  const { data } = await supabase
    .from('otp_codes')
    .select('*')
    .eq('phone', phone)
    .eq('code', code)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return { valid: false, reason: 'OTP tidak valid atau sudah expired' };

  await supabase.from('otp_codes').update({ used_at: new Date() }).eq('id', data.id);
  return { valid: true };
}

export async function sendViaFonnte(
  phone: string,
  otp: string
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FONNTE_TIMEOUT);

  try {
    const res = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: FONNTE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: phone,
        message: `Kode OTP Arisan App kamu: *${otp}*. Berlaku 5 menit. Jangan berikan ke siapapun.`,
      }),
      signal: controller.signal,
    });

    const status = res.ok ? 'sent' : 'failed';
    const errorMsg = res.ok ? undefined : `HTTP ${res.status}`;

    await supabase.from('otp_delivery_log').insert({ phone, status, error_message: errorMsg });

    if (!res.ok) return { success: false, error: 'Gagal mengirim OTP via WhatsApp' };
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error && err.name === 'AbortError' ? 'Timeout' : String(err);
    await supabase.from('otp_delivery_log').insert({ phone, status: 'failed', error_message: msg });
    logger.error('Fonnte send failed', { phone, error: msg });
    return { success: false, error: 'Gagal mengirim OTP. Coba lagi dalam 30 detik.' };
  } finally {
    clearTimeout(timer);
  }
}
