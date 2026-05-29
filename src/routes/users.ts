import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { jwtAuth } from '../middleware/auth';
import { generateUserToken } from '../services/streamio';
import { supabase } from '../db/supabase';

type Variables = { userId: string; phone: string };

export const usersRoute = new Hono<{ Variables: Variables }>();
usersRoute.use('*', jwtAuth);

usersRoute.get('/me', async (c) => {
  const userId = c.get('userId');
  const { data } = await supabase
    .from('users')
    .select('id, phone, name, created_at')
    .eq('id', userId)
    .single();
  if (!data) return c.json({ error: 'User tidak ditemukan' }, 404);
  return c.json({ user: data });
});

usersRoute.put(
  '/me',
  zValidator('json', z.object({ name: z.string().min(2).max(100) })),
  async (c) => {
    const userId = c.get('userId');
    const { name } = c.req.valid('json');
    await supabase.from('users').update({ name }).eq('id', userId);
    return c.json({ message: 'Profil berhasil diperbarui' });
  }
);

usersRoute.delete('/me', async (c) => {
  const userId = c.get('userId');
  // Anonymize — jangan hapus fisik (UU PDP)
  await supabase
    .from('users')
    .update({
      name: null,
      phone: `+62DELETED${userId.slice(0, 8)}`,
      deleted_at: new Date(),
    })
    .eq('id', userId);
  return c.json({ message: 'Akun berhasil dihapus' });
});

usersRoute.get('/stream-token', (c) => {
  const userId = c.get('userId');
  const token = generateUserToken(userId);
  return c.json({ token });
});

usersRoute.put(
  '/push-token',
  zValidator('json', z.object({ expo_push_token: z.string() })),
  async (c) => {
    const userId = c.get('userId');
    const { expo_push_token } = c.req.valid('json');
    await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, expo_push_token, updated_at: new Date() });
    return c.json({ message: 'Push token tersimpan' });
  }
);
