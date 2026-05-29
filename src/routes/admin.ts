import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { StreamChat } from 'stream-chat';
import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { maskPhone } from '../utils/mask';

export const adminRoute = new Hono();

const adminAuth = createMiddleware(async (c, next) => {
  if (c.req.header('X-Admin-Secret') !== process.env.ADMIN_SECRET_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

adminRoute.use('*', adminAuth);

// GET /admin/stats/overview
adminRoute.get('/stats/overview', async (c) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [
    { count: totalUsers },
    { count: activeGroups },
    { count: otpThisMonth },
    { count: pushTokens },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('groups').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase
      .from('otp_codes')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString()),
    supabase.from('push_tokens').select('*', { count: 'exact', head: true }),
  ]);

  return c.json({
    total_users: totalUsers ?? 0,
    active_groups: activeGroups ?? 0,
    otp_this_month: otpThisMonth ?? 0,
    push_tokens_registered: pushTokens ?? 0,
  });
});

// GET /admin/users?page=1&limit=20&search=&status=
adminRoute.get(
  '/users',
  zValidator(
    'query',
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
      status: z.enum(['active', 'suspended', '']).optional(),
    })
  ),
  async (c) => {
    const { page, limit, search, status } = c.req.valid('query');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('users')
      .select('id, phone, name, created_at, deleted_at', { count: 'exact' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (status === 'suspended') {
      query = query.not('deleted_at', 'is', null);
    } else if (status === 'active') {
      query = query.is('deleted_at', null);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Admin users list gagal', { error });
      return c.json({ error: 'Gagal mengambil data user' }, 500);
    }

    const users = (data ?? []).map((u) => ({
      id: u.id,
      phone: maskPhone(u.phone),
      name: u.name,
      created_at: u.created_at,
      status: u.deleted_at ? 'suspended' : 'active',
    }));

    return c.json({
      users,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
    });
  }
);

// GET /admin/users/:id
adminRoute.get('/users/:id', async (c) => {
  const id = c.req.param('id');

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, phone, name, created_at, deleted_at')
    .eq('id', id)
    .single();

  if (userError || !user) return c.json({ error: 'User tidak ditemukan' }, 404);

  const { data: groups } = await supabase
    .from('group_members')
    .select('group_id, urutan, joined_at, groups(id, name, status)')
    .eq('user_id', id);

  const { data: otpHistory } = await supabase
    .from('otp_delivery_log')
    .select('status, error_message, sent_at')
    .eq('phone', user.phone)
    .order('sent_at', { ascending: false })
    .limit(20);

  return c.json({
    user: {
      id: user.id,
      phone: maskPhone(user.phone),
      name: user.name,
      created_at: user.created_at,
      status: user.deleted_at ? 'suspended' : 'active',
    },
    groups: groups ?? [],
    otp_delivery_history: otpHistory ?? [],
  });
});

// POST /admin/users/:id/suspend
adminRoute.post('/users/:id/suspend', async (c) => {
  const id = c.req.param('id');

  const { error } = await supabase
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    logger.error('Admin suspend user gagal', { id, error });
    return c.json({ error: 'Gagal suspend user' }, 500);
  }

  logger.info('Admin suspend user', { id });
  return c.json({ message: 'User berhasil di-suspend' });
});

// POST /admin/users/:id/unsuspend
adminRoute.post('/users/:id/unsuspend', async (c) => {
  const id = c.req.param('id');

  const { error } = await supabase.from('users').update({ deleted_at: null }).eq('id', id);

  if (error) {
    logger.error('Admin unsuspend user gagal', { id, error });
    return c.json({ error: 'Gagal unsuspend user' }, 500);
  }

  logger.info('Admin unsuspend user', { id });
  return c.json({ message: 'User berhasil di-unsuspend' });
});

// DELETE /admin/users/:id — anonymize (UU PDP)
adminRoute.delete('/users/:id', async (c) => {
  const id = c.req.param('id');

  const { error } = await supabase
    .from('users')
    .update({
      name: null,
      phone: `+62DELETED${id.slice(0, 8)}`,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    logger.error('Admin anonymize user gagal', { id, error });
    return c.json({ error: 'Gagal anonymize user' }, 500);
  }

  logger.info('Admin anonymize user', { id });
  return c.json({ message: 'User berhasil dianonimkan' });
});

// GET /admin/groups?page=1&status=
adminRoute.get(
  '/groups',
  zValidator(
    'query',
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.string().optional(),
    })
  ),
  async (c) => {
    const { page, limit, status } = c.req.valid('query');
    const offset = (page - 1) * limit;

    let query = supabase
      .from('groups')
      .select('id, name, status, nominal, frekuensi, jumlah_periode, created_at', {
        count: 'exact',
      });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Admin groups list gagal', { error });
      return c.json({ error: 'Gagal mengambil data grup' }, 500);
    }

    return c.json({
      groups: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
    });
  }
);

// GET /admin/groups/:id
adminRoute.get('/groups/:id', async (c) => {
  const id = c.req.param('id');

  const { data: group, error: groupError } = await supabase
    .from('groups')
    .select(
      'id, name, status, nominal, frekuensi, jumlah_periode, invite_code, created_at, ketua_id'
    )
    .eq('id', id)
    .single();

  if (groupError || !group) return c.json({ error: 'Grup tidak ditemukan' }, 404);

  const { data: members } = await supabase
    .from('group_members')
    .select('user_id, urutan, joined_at, users(id, name, phone)')
    .eq('group_id', id)
    .order('urutan', { ascending: true });

  const { data: periods } = await supabase
    .from('periods')
    .select('id, periode_ke, status, tanggal_pelaksanaan, jatuh_tempo')
    .eq('group_id', id)
    .order('periode_ke', { ascending: true });

  const periodIds = (periods ?? []).map((p) => p.id);
  let paymentSummary: { period_id: string; confirmed: number; pending: number }[] = [];

  if (periodIds.length > 0) {
    const { data: payments } = await supabase
      .from('payments')
      .select('period_id, status')
      .in('period_id', periodIds);

    const summaryMap = new Map<string, { confirmed: number; pending: number }>();
    for (const p of payments ?? []) {
      const entry = summaryMap.get(p.period_id) ?? { confirmed: 0, pending: 0 };
      if (p.status === 'confirmed') entry.confirmed++;
      else entry.pending++;
      summaryMap.set(p.period_id, entry);
    }
    paymentSummary = Array.from(summaryMap.entries()).map(([period_id, counts]) => ({
      period_id,
      ...counts,
    }));
  }

  const maskedMembers = (members ?? []).map((m) => {
    const user = m.users as unknown as { id: string; name: string; phone: string } | null;
    return {
      user_id: m.user_id,
      urutan: m.urutan,
      joined_at: m.joined_at,
      name: user?.name ?? null,
      phone: user?.phone ? maskPhone(user.phone) : null,
    };
  });

  return c.json({
    group,
    members: maskedMembers,
    periods: periods ?? [],
    payment_summary: paymentSummary,
  });
});

// GET /admin/otp-stats
adminRoute.get('/otp-stats', async (c) => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: otpLogs, error } = await supabase
    .from('otp_codes')
    .select('created_at')
    .gte('created_at', thirtyDaysAgo.toISOString());

  if (error) {
    logger.error('Admin otp-stats gagal', { error });
    return c.json({ error: 'Gagal mengambil statistik OTP' }, 500);
  }

  const dailyMap = new Map<string, number>();
  for (const row of otpLogs ?? []) {
    const day = row.created_at.split('T')[0];
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }

  const daily_usage = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const { data: rateLimited } = await supabase
    .from('otp_rate_limit')
    .select('phone, attempt_count, window_start')
    .gte('attempt_count', 5);

  const rate_limited_numbers = (rateLimited ?? []).map((r) => ({
    phone: maskPhone(r.phone),
    attempt_count: r.attempt_count,
    window_start: r.window_start,
  }));

  return c.json({ daily_usage, rate_limited_numbers });
});

// GET /admin/system-health
adminRoute.get('/system-health', async (c) => {
  let supabaseStatus: 'ok' | 'error' = 'error';
  let streamStatus: 'ok' | 'error' = 'error';

  try {
    const { error } = await supabase.rpc('health_check_select1').single();
    supabaseStatus = error ? 'error' : 'ok';
  } catch {
    // fallback: try a simple table query
    try {
      const { error } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .limit(1);
      supabaseStatus = error ? 'error' : 'ok';
    } catch {
      supabaseStatus = 'error';
    }
  }

  try {
    const client = StreamChat.getInstance(
      process.env.STREAM_API_KEY!,
      process.env.STREAM_API_SECRET!
    );
    await client.queryChannels({}, {}, { limit: 1 });
    streamStatus = 'ok';
  } catch {
    streamStatus = 'error';
  }

  return c.json({
    supabase: supabaseStatus,
    api: 'ok',
    stream: streamStatus,
  });
});

// POST /admin/cron/trigger/:type
const triggerTypeSchema = z.enum(['payment-reminder', 'pelaksanaan-reminder', 'mark-late']);

adminRoute.post('/cron/trigger/:type', async (c) => {
  const typeParam = c.req.param('type');
  const parsed = triggerTypeSchema.safeParse(typeParam);

  if (!parsed.success) {
    return c.json(
      {
        error: 'Tipe cron tidak valid. Gunakan: payment-reminder, pelaksanaan-reminder, mark-late',
      },
      400
    );
  }

  const type = parsed.data;
  const cronSecret = process.env.CRON_SECRET ?? '';
  const baseUrl = `http://localhost:${process.env.PORT ?? '3001'}`;

  let endpoint: string;
  if (type === 'payment-reminder') {
    endpoint = '/api/cron/payment-reminder';
  } else if (type === 'pelaksanaan-reminder') {
    endpoint = '/api/cron/pelaksanaan-reminder';
  } else {
    endpoint = '/api/payments/cron/mark-late';
  }

  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      headers: { 'X-Cron-Secret': cronSecret },
    });
    const body = await res.json();
    logger.info('Admin cron trigger', { type, status: res.status });
    return c.json({ ok: true, type, result: body });
  } catch (err) {
    logger.error('Admin cron trigger gagal', { type, err });
    return c.json({ error: 'Gagal menjalankan cron' }, 503);
  }
});
