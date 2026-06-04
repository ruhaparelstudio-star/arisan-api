import { Hono } from 'hono';
import { z } from 'zod';
import { zv } from '../utils/zv';
import { sign, verify } from 'jsonwebtoken';
import { supabase } from '../db/supabase';
import * as otpService from '../services/otp';
import { logger } from '../utils/logger';
import { maskPhone } from '../utils/mask';

export const authRoute = new Hono();

const sendSchema = z.object({
  phone: z.string().regex(/^\+62\d{9,12}$/, 'Format nomor tidak valid. Gunakan format +62xxx'),
});

const verifySchema = z.object({
  phone: z.string().regex(/^\+62\d{9,12}$/),
  code: z.string().length(6, 'Kode OTP harus 6 digit'),
});

// Nomor test sandbox — hanya aktif saat NODE_ENV=development
const TEST_PHONE_PREFIX = '+628560000100';
const TEST_OTP_CODE = '123456';
const isTestPhone = (phone: string) =>
  process.env.NODE_ENV === 'development' && phone.startsWith(TEST_PHONE_PREFIX);

authRoute.post('/send-otp', zv('json', sendSchema), async (c) => {
  const { phone } = c.req.valid('json');

  // Dev sandbox: nomor test skip Fonnte, pakai OTP tetap "123456"
  if (isTestPhone(phone)) {
    await otpService.saveOTP(phone, TEST_OTP_CODE);
    logger.info('Test OTP (dev sandbox)', { phone: maskPhone(phone) });
    return c.json({ message: 'OTP berhasil dikirim ke WhatsApp kamu' });
  }

  const rateCheck = await otpService.checkRateLimit(phone);
  if (!rateCheck.allowed) {
    return c.json({ error: 'Terlalu banyak percobaan. Coba lagi dalam 1 jam.' }, 429);
  }

  const code = otpService.generateOTP();
  await otpService.saveOTP(phone, code);

  const result = await otpService.sendViaFonnte(phone, code);
  if (!result.success) {
    return c.json({ error: result.error }, 503);
  }

  logger.info('OTP sent', { phone: maskPhone(phone) });
  return c.json({ message: 'OTP berhasil dikirim ke WhatsApp kamu' });
});

authRoute.post('/verify-otp', zv('json', verifySchema), async (c) => {
  const { phone, code } = c.req.valid('json');

  const verification = await otpService.verifyOTP(phone, code);
  if (!verification.valid) {
    return c.json({ error: verification.reason }, 400);
  }

  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  let user = existing;
  if (!user) {
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({ phone })
      .select()
      .single();
    if (insertError) {
      logger.error('Gagal membuat user baru', { phone: maskPhone(phone), error: insertError });
      return c.json({ error: 'Gagal membuat akun. Coba lagi.' }, 500);
    }
    user = newUser;
  }

  if (!user) {
    logger.error('User null setelah select/insert', { phone: maskPhone(phone), selectError });
    return c.json({ error: 'Gagal memuat akun. Coba lagi.' }, 500);
  }

  const token = sign({ userId: user.id, phone: user.phone }, process.env.JWT_SECRET!, {
    expiresIn: '30d',
  });

  logger.info('User logged in', { userId: user.id });
  return c.json({ token, user: { id: user.id, phone: user.phone, name: user.name } });
});

// POST /api/auth/refresh — perbarui token yang hampir expired tanpa OTP ulang
// Butuh token valid di header Authorization
authRoute.post('/refresh', async (c) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer '))
    return c.json({ error: 'Token tidak ditemukan. Silakan login kembali.' }, 401);

  let payload: { userId: string; phone: string };
  try {
    payload = verify(header.slice(7), process.env.JWT_SECRET!) as { userId: string; phone: string };
  } catch {
    return c.json({ error: 'Token tidak valid atau sudah expired. Silakan login kembali.' }, 401);
  }

  const { data: user } = await supabase
    .from('users')
    .select('id, phone, name, deleted_at')
    .eq('id', payload.userId)
    .single();

  if (!user || user.deleted_at)
    return c.json({ error: 'Akun tidak ditemukan atau ditangguhkan.' }, 403);

  const token = sign({ userId: user.id, phone: user.phone }, process.env.JWT_SECRET!, {
    expiresIn: '30d',
  });

  logger.info('Token refreshed', { userId: user.id });
  return c.json({ token, user: { id: user.id, phone: user.phone, name: user.name } });
});
