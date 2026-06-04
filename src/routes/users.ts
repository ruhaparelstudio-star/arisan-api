import { Hono } from 'hono';
import { z } from 'zod';
import { zv } from '../utils/zv';
import { jwtAuth } from '../middleware/auth';
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

usersRoute.put('/me', zv('json', z.object({ name: z.string().min(2).max(100) })), async (c) => {
  const userId = c.get('userId');
  const { name } = c.req.valid('json');
  await supabase.from('users').update({ name }).eq('id', userId);
  return c.json({ message: 'Profil berhasil diperbarui' });
});

usersRoute.delete('/me', async (c) => {
  const userId = c.get('userId');
  // Anonymize — jangan hapus fisik (UU PDP)
  await supabase
    .from('users')
    .update({
      name: null,
      phone: `+62DELETED${userId.slice(0, 8)}`,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', userId);
  return c.json({ message: 'Akun berhasil dihapus' });
});

// GET /api/users/me/stats — total grup, total iuran terkonfirmasi, total menang undian
usersRoute.get('/me/stats', async (c) => {
  const userId = c.get('userId');

  const [groupsRes, paymentsRes, winsRes] = await Promise.all([
    supabase
      .from('group_members')
      .select('group_id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('payments')
      .select('period_id, periods(group_id, groups!group_id(nominal))')
      .eq('user_id', userId)
      .eq('status', 'confirmed'),
    supabase.from('winners').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  const groupCount = groupsRes.count ?? 0;
  const winCount = winsRes.count ?? 0;

  const totalIuran = (paymentsRes.data ?? []).reduce((sum: number, p: Record<string, unknown>) => {
    const nominal = (p.periods as Record<string, unknown> | null)
      ? ((p.periods as Record<string, unknown>).groups as Record<string, unknown> | null)
        ? ((((p.periods as Record<string, unknown>).groups as Record<string, unknown>)
            .nominal as number) ?? 0)
        : 0
      : 0;
    return sum + nominal;
  }, 0);

  return c.json({ group_count: groupCount, total_iuran: totalIuran, win_count: winCount });
});

usersRoute.put('/push-token', zv('json', z.object({ expo_push_token: z.string() })), async (c) => {
  const userId = c.get('userId');
  const { expo_push_token } = c.req.valid('json');
  await supabase
    .from('push_tokens')
    .upsert({ user_id: userId, expo_push_token, updated_at: new Date().toISOString() });
  return c.json({ message: 'Push token tersimpan' });
});
