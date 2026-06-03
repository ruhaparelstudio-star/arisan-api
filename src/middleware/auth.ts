import { createMiddleware } from 'hono/factory';
import { verify } from 'jsonwebtoken';
import { supabase } from '../db/supabase';

type AuthVariables = { userId: string; phone: string };

export const jwtAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Token tidak ditemukan. Silakan login kembali.' }, 401);
  }
  try {
    const token = header.slice(7);
    const payload = verify(token, process.env.JWT_SECRET!) as { userId: string; phone: string };

    // Cek user tidak di-suspend (deleted_at IS NOT NULL = suspended)
    const { data: user } = await supabase
      .from('users')
      .select('deleted_at')
      .eq('id', payload.userId)
      .single();
    if (user?.deleted_at) {
      return c.json({ error: 'Akun kamu telah ditangguhkan. Hubungi admin untuk informasi lebih lanjut.' }, 403);
    }

    c.set('userId', payload.userId);
    c.set('phone', payload.phone);
    await next();
  } catch {
    return c.json({ error: 'Token tidak valid atau sudah expired. Silakan login kembali.' }, 401);
  }
});
