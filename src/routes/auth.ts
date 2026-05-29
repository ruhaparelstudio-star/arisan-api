import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sign } from 'jsonwebtoken';
import { supabase } from '../db/supabase';
import * as otpService from '../services/otp';
import { logger } from '../utils/logger';

export const authRoute = new Hono();

const sendSchema = z.object({
  phone: z.string().regex(/^\+62\d{9,12}$/, 'Format nomor tidak valid. Gunakan format +62xxx'),
});

const verifySchema = z.object({
  phone: z.string().regex(/^\+62\d{9,12}$/),
  code: z.string().length(6, 'Kode OTP harus 6 digit'),
});

authRoute.post('/send-otp', zValidator('json', sendSchema), async (c) => {
  const { phone } = c.req.valid('json');

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

  logger.info('OTP sent', { phone });
  return c.json({ message: 'OTP berhasil dikirim ke WhatsApp kamu' });
});

authRoute.post('/verify-otp', zValidator('json', verifySchema), async (c) => {
  const { phone, code } = c.req.valid('json');

  const verification = await otpService.verifyOTP(phone, code);
  if (!verification.valid) {
    return c.json({ error: verification.reason }, 400);
  }

  const { data: existing } = await supabase.from('users').select('*').eq('phone', phone).single();

  let user = existing;
  if (!user) {
    const { data: newUser } = await supabase.from('users').insert({ phone }).select().single();
    user = newUser;
  }

  const token = sign({ userId: user!.id, phone: user!.phone }, process.env.JWT_SECRET!, {
    expiresIn: '30d',
  });

  logger.info('User logged in', { userId: user!.id });
  return c.json({ token, user: { id: user!.id, phone: user!.phone, name: user!.name } });
});
