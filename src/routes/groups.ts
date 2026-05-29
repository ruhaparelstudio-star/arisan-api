import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { jwtAuth } from '../middleware/auth';
import * as gs from '../services/groups';
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
    .select('urutan, users(id, name, phone)')
    .eq('group_id', groupId)
    .order('urutan');

  return c.json({ group, members });
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
