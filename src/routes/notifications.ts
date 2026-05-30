import { Hono } from 'hono';
import { jwtAuth } from '../middleware/auth';
import { supabase } from '../db/supabase';

type Variables = { userId: string };

export const notificationsRoute = new Hono<{ Variables: Variables }>();
notificationsRoute.use('*', jwtAuth);

// GET /api/notifications?limit=20&before=<uuid>
notificationsRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 50);
  const before = c.req.query('before');

  let query = supabase
    .from('notifications')
    .select('id, type, title, body, data, is_read, created_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);

  if (before) {
    const { data: pivot } = await supabase
      .from('notifications')
      .select('created_at')
      .eq('id', before)
      .single();
    if (pivot) query = query.lt('created_at', pivot.created_at);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: 'Gagal memuat notifikasi' }, 500);

  const rows = data ?? [];
  const has_more = rows.length > limit;
  const notifications = has_more ? rows.slice(0, limit) : rows;

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  return c.json({ notifications, unread_count: count ?? 0, has_more });
});

// PATCH /api/notifications/read-all — harus sebelum /:id/read agar tidak tertangkap sebagai param
notificationsRoute.patch('/read-all', async (c) => {
  const userId = c.get('userId');

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) return c.json({ error: 'Gagal menandai semua notifikasi' }, 500);
  return c.json({ message: 'Semua notifikasi ditandai sudah dibaca' });
});

// PATCH /api/notifications/:id/read
notificationsRoute.patch('/:id/read', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return c.json({ error: 'Gagal menandai notifikasi' }, 500);
  return c.json({ message: 'Notifikasi ditandai sudah dibaca' });
});
