import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { jwtAuth } from '../middleware/auth';
import * as gs from '../services/groups';
import {
  createGroupChannel,
  addMemberToChannel,
  removeMemberFromChannel,
} from '../services/streamio';
import { supabase } from '../db/supabase';

type Variables = { userId: string; phone: string };

export const groupsRoute = new Hono<{ Variables: Variables }>();
groupsRoute.use('*', jwtAuth);

const createSchema = z.object({
  name: z.string().min(3).max(100),
  nominal: z.number().int().min(10000).max(100_000_000),
  frekuensi: z.enum(['weekly', 'biweekly', 'monthly']),
  jumlah_periode: z.number().int().min(2).max(100),
  mode_undian: z.enum(['fixed', 'random', 'manual']),
});

// POST /api/groups
groupsRoute.post('/', zValidator('json', createSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const check = await gs.canUserJoinOrCreate(userId);
  if (!check.allowed) return c.json({ error: check.reason }, 403);

  const inviteCode = await gs.generateInviteCode();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const { data: group, error } = await supabase
    .from('groups')
    .insert({
      ...body,
      ketua_id: userId,
      invite_code: inviteCode,
      invite_code_expires_at: expiresAt,
    })
    .select()
    .single();

  if (error || !group) return c.json({ error: 'Gagal membuat grup' }, 500);

  await supabase.from('group_members').insert({ group_id: group.id, user_id: userId, urutan: 1 });
  await createGroupChannel(group.id, body.name, userId);
  await gs.logActivity(group.id, userId, 'group_created', `Grup "${body.name}" dibuat`);

  return c.json({ group }, 201);
});

// GET /api/groups
groupsRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const { data } = await supabase
    .from('group_members')
    .select('urutan, groups(*)')
    .eq('user_id', userId);
  return c.json({ groups: data?.map((d) => ({ ...d.groups, urutan_saya: d.urutan })) ?? [] });
});

// GET /api/groups/code/:code — preview grup sebelum join
// Harus sebelum GET /:id agar tidak ditangkap sebagai param
groupsRoute.get('/code/:code', async (c) => {
  const { code } = c.req.param();
  const { data: group } = await supabase
    .from('groups')
    .select(
      'id, name, nominal, frekuensi, jumlah_periode, mode_undian, invite_code, status, ketua_id, created_at, group_members(count)'
    )
    .eq('invite_code', code.toUpperCase())
    .single();
  if (!group) return c.json({ error: 'Kode tidak valid' }, 404);
  const counts = group.group_members as unknown as { count: number }[];
  const memberCount = counts[0]?.count ?? 0;
  return c.json({
    id: group.id,
    name: group.name,
    nominal: group.nominal,
    frekuensi: group.frekuensi,
    jumlah_periode: group.jumlah_periode,
    mode_undian: group.mode_undian,
    invite_code: group.invite_code,
    status: group.status,
    ketua_id: group.ketua_id,
    created_at: group.created_at,
    member_count: memberCount,
  });
});

// POST /api/groups/join — harus sebelum /:id agar tidak ditangkap sebagai param
groupsRoute.post(
  '/join',
  zValidator('json', z.object({ invite_code: z.string().length(8).toUpperCase() })),
  async (c) => {
    const userId = c.get('userId');
    const { invite_code } = c.req.valid('json');

    const { data: group } = await supabase
      .from('groups')
      .select('*')
      .eq('invite_code', invite_code)
      .single();
    if (!group) return c.json({ error: 'Kode tidak valid atau sudah tidak aktif' }, 404);
    if (group.status !== 'recruiting')
      return c.json({ error: 'Grup ini sudah tidak menerima anggota baru' }, 400);

    const { data: existing } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .single();
    if (existing) return c.json({ error: 'Kamu sudah bergabung di grup ini' }, 400);

    const check = await gs.canUserJoinOrCreate(userId);
    if (!check.allowed) return c.json({ error: check.reason }, 403);

    const { count } = await supabase
      .from('group_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', group.id);
    await supabase
      .from('group_members')
      .insert({ group_id: group.id, user_id: userId, urutan: (count ?? 0) + 1 });

    if ((count ?? 0) + 1 >= group.jumlah_periode) await gs.invalidateInviteCode(group.id);

    await addMemberToChannel(group.id, userId);
    await gs.logActivity(group.id, userId, 'member_joined', `Anggota baru bergabung`);
    return c.json({ group, message: `Berhasil bergabung ke grup "${group.name}"` });
  }
);

// GET /api/groups/:id
groupsRoute.get('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  const { data: membership } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (!membership) return c.json({ error: 'Kamu bukan anggota grup ini' }, 403);

  const { data: group } = await supabase.from('groups').select('*').eq('id', groupId).single();
  const { data: members } = await supabase
    .from('group_members')
    .select('user_id, urutan, users(id, name, phone)')
    .eq('group_id', groupId)
    .order('urutan');

  const { data: activePeriod } = await supabase
    .from('periods')
    .select('id, periode_ke')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .maybeSingle();

  return c.json({
    group,
    members,
    current_period_id: activePeriod?.id ?? null,
    current_period: activePeriod?.periode_ke ?? null,
  });
});

// PUT /api/groups/:id/urutan
groupsRoute.put(
  '/:id/urutan',
  zValidator('json', z.object({ urutan: z.array(z.string().uuid()) })),
  async (c) => {
    const userId = c.get('userId');
    const groupId = c.req.param('id');
    const { urutan } = c.req.valid('json');

    const { data: group } = await supabase
      .from('groups')
      .select('ketua_id')
      .eq('id', groupId)
      .single();
    if (!group || group.ketua_id !== userId)
      return c.json({ error: 'Hanya ketua yang bisa mengatur giliran' }, 403);

    if (!(await gs.isGroupEditable(groupId)))
      return c.json({ error: 'Urutan tidak bisa diubah setelah arisan berjalan' }, 400);

    for (let i = 0; i < urutan.length; i++) {
      await supabase
        .from('group_members')
        .update({ urutan: i + 1 })
        .eq('group_id', groupId)
        .eq('user_id', urutan[i]);
    }
    await gs.logActivity(groupId, userId, 'urutan_updated', 'Urutan giliran diperbarui');
    return c.json({ message: 'Urutan giliran berhasil diperbarui' });
  }
);

// POST /api/groups/:id/invite — regenerate kode invite (ketua only)
groupsRoute.post('/:id/invite', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id')
    .eq('id', groupId)
    .single();
  if (!group) return c.json({ error: 'Grup tidak ditemukan' }, 404);
  if (group.ketua_id !== userId)
    return c.json({ error: 'Hanya ketua yang bisa generate kode' }, 403);
  const newCode = await gs.generateInviteCode();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await supabase
    .from('groups')
    .update({ invite_code: newCode, invite_code_expires_at: expiresAt })
    .eq('id', groupId);
  await gs.logActivity(groupId, userId, 'invite_regenerated', 'Kode invite diperbarui');
  return c.json({ invite_code: newCode });
});

// GET /api/groups/:id/periods — list semua periode grup
groupsRoute.get('/:id/periods', async (c) => {
  const groupId = c.req.param('id');
  const { data } = await supabase
    .from('periods')
    .select('*')
    .eq('group_id', groupId)
    .order('periode_ke');
  return c.json({ periods: data ?? [] });
});

// GET /api/groups/:id/activity-log — riwayat aktivitas grup
groupsRoute.get('/:id/activity-log', async (c) => {
  const groupId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '30');
  const offset = parseInt(c.req.query('offset') ?? '0');
  const { data, count } = await supabase
    .from('activity_log')
    .select('*, actor:users!actor_id(name)', { count: 'exact' })
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const ICON_MAP: Record<string, { icon: string; tone: string }> = {
    group_created: { icon: 'users', tone: 'mint' },
    member_joined: { icon: 'users', tone: 'mint' },
    member_left: { icon: 'users', tone: 'neutral' },
    payment_confirmed: { icon: 'checkCircle', tone: 'mint' },
    payment_cancelled: { icon: 'checkCircle', tone: 'amber' },
    undian: { icon: 'sparkles', tone: 'mint' },
    urutan_updated: { icon: 'swap', tone: 'blue' },
    group_disbanded: { icon: 'alert', tone: 'amber' },
    invite_regenerated: { icon: 'share', tone: 'blue' },
    tanggal_updated: { icon: 'checkCircle', tone: 'blue' },
  };

  type ActivityRow = { id: string; action: string; description: string; created_at: string };
  const entries = (data ?? []).map((row) => {
    const r = row as ActivityRow;
    const meta = ICON_MAP[r.action] ?? { icon: 'checkCircle', tone: 'neutral' };
    return {
      id: r.id,
      icon: meta.icon,
      tone: meta.tone,
      text: r.description,
      created_at: r.created_at,
    };
  });

  return c.json({ entries, has_more: (count ?? 0) > offset + limit });
});

// PUT /api/groups/:groupId/periods/:periodId/tanggal
groupsRoute.put(
  '/:groupId/periods/:periodId/tanggal',
  zValidator('json', z.object({ tanggal_pelaksanaan: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  async (c) => {
    const userId = c.get('userId');
    const groupId = c.req.param('groupId');
    const periodId = c.req.param('periodId');
    const { tanggal_pelaksanaan } = c.req.valid('json');

    const { data: group } = await supabase
      .from('groups')
      .select('ketua_id')
      .eq('id', groupId)
      .single();

    if (!group) return c.json({ error: 'Grup tidak ditemukan' }, 404);
    if (group.ketua_id !== userId)
      return c.json({ error: 'Hanya ketua yang bisa mengatur tanggal pelaksanaan' }, 403);

    const { data: period } = await supabase
      .from('periods')
      .select('id, status, tanggal_pelaksanaan')
      .eq('id', periodId)
      .eq('group_id', groupId)
      .single();

    if (!period) return c.json({ error: 'Periode tidak ditemukan' }, 404);
    if (period.status === 'completed')
      return c.json({ error: 'Tanggal tidak bisa diubah untuk periode yang sudah selesai' }, 400);

    // jatuh_tempo = tanggal_pelaksanaan - 3 hari
    const tanggal = new Date(tanggal_pelaksanaan);
    const jatuhTempo = new Date(tanggal.getTime() - 3 * 24 * 60 * 60 * 1000);
    const jatuh_tempo = jatuhTempo.toISOString().split('T')[0];

    const { error } = await supabase
      .from('periods')
      .update({ tanggal_pelaksanaan, jatuh_tempo })
      .eq('id', periodId);

    if (error) return c.json({ error: 'Gagal memperbarui tanggal pelaksanaan' }, 500);

    const oldTanggal = period.tanggal_pelaksanaan ?? 'belum diset';
    await gs.logActivity(
      groupId,
      userId,
      'tanggal_updated',
      `Tanggal pelaksanaan periode diubah: ${oldTanggal} → ${tanggal_pelaksanaan} (jatuh_tempo: ${jatuh_tempo})`
    );

    return c.json({ tanggal_pelaksanaan, jatuh_tempo });
  }
);

// DELETE /api/groups/:id/leave — harus sebelum DELETE /:id
groupsRoute.delete('/:id/leave', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id, name')
    .eq('id', groupId)
    .single();
  if (!group) return c.json({ error: 'Grup tidak ditemukan' }, 404);
  if (group.ketua_id === userId)
    return c.json({ error: 'Ketua tidak bisa keluar — bubarkan grup terlebih dahulu' }, 400);
  if (!(await gs.isGroupEditable(groupId)))
    return c.json({ error: 'Tidak bisa keluar saat arisan sedang berjalan' }, 400);

  await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
  await removeMemberFromChannel(groupId, userId);
  await gs.logActivity(groupId, userId, 'member_left', 'Anggota keluar dari grup');
  return c.json({ message: `Kamu keluar dari grup "${group.name}"` });
});

// DELETE /api/groups/:id
groupsRoute.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');
  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id, name')
    .eq('id', groupId)
    .single();
  if (!group || group.ketua_id !== userId)
    return c.json({ error: 'Hanya ketua yang bisa membubarkan grup' }, 403);
  if (!(await gs.isGroupEditable(groupId)))
    return c.json({ error: 'Tidak bisa membubarkan grup yang sedang berjalan' }, 400);

  await supabase.from('groups').update({ status: 'disbanded' }).eq('id', groupId);
  await gs.logActivity(groupId, userId, 'group_disbanded', `Grup dibubarkan oleh ketua`);
  return c.json({ message: `Grup "${group.name}" berhasil dibubarkan` });
});
