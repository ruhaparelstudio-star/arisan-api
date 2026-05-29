import { createMiddleware } from 'hono/factory';
import { verify } from 'jsonwebtoken';

type AuthVariables = { userId: string; phone: string };

export const jwtAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Token tidak ditemukan. Silakan login kembali.' }, 401);
  }
  try {
    const token = header.slice(7);
    const payload = verify(token, process.env.JWT_SECRET!) as { userId: string; phone: string };
    c.set('userId', payload.userId);
    c.set('phone', payload.phone);
    await next();
  } catch {
    return c.json({ error: 'Token tidak valid atau sudah expired. Silakan login kembali.' }, 401);
  }
});
