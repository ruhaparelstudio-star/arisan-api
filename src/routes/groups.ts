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
import { sendExpoPush, insertNotification } from '../services/notifications';
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

// GET /api/groups/:id/hutang — daftar anggota yang sudah menang tapi masih punya hutang (kabur risk)
groupsRoute.get('/:id/hutang', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id, nominal, name')
    .eq('id', groupId)
    .single();
  if (!group || group.ketua_id !== userId)
    return c.json({ error: 'Hanya ketua yang bisa melihat data hutang' }, 403);

  // Ambil semua anggota, periode, dan pemenang
  const [{ data: members }, { data: periods }, { data: winners }] = await Promise.all([
    supabase.from('group_members').select('user_id').eq('group_id', groupId),
    supabase
      .from('periods')
      .select('id, periode_ke, status')
      .eq('group_id', groupId)
      .order('periode_ke'),
    supabase
      .from('winners')
      .select('user_id, period_id, periods!inner(periode_ke)')
      .eq('group_id', groupId),
  ]);

  const activePeriod = (periods ?? []).find((p) => p.status === 'active');
  if (!activePeriod) return c.json({ debtors: [], impact_per_winner: 0 });

  // Periode yang sudah/sedang berjalan (closed + active)
  const runningPeriods = (periods ?? []).filter((p) => ['active', 'closed'].includes(p.status));

  const debtors: Array<{
    user_id: string;
    name: string;
    won_period: number;
    total_hutang: number;
    detail: Array<{ period_number: number; status: string }>;
  }> = [];

  for (const winner of winners ?? []) {
    const wonPeriode = (winner.periods as unknown as { periode_ke: number }).periode_ke;
    // Periode SETELAH menang yang harus dibayar
    const periodsAfterWin = runningPeriods.filter((p) => p.periode_ke > wonPeriode);
    if (!periodsAfterWin.length) continue;

    const { data: payments } = await supabase
      .from('payments')
      .select('period_id, status')
      .eq('user_id', winner.user_id)
      .in(
        'period_id',
        periodsAfterWin.map((p) => p.id)
      );

    const paymentMap: Record<string, string> = {};
    for (const py of payments ?? []) paymentMap[py.period_id] = py.status;

    const unpaidPeriods = periodsAfterWin.filter(
      (p) => (paymentMap[p.id] ?? 'pending') !== 'confirmed'
    );

    if (unpaidPeriods.length === 0) continue;

    const { data: uData } = await supabase
      .from('users')
      .select('name, phone')
      .eq('id', winner.user_id)
      .single();

    debtors.push({
      user_id: winner.user_id,
      name: uData?.name ?? uData?.phone ?? '—',
      won_period: wonPeriode,
      total_hutang: unpaidPeriods.length * group.nominal,
      detail: unpaidPeriods.map((p) => ({
        period_number: p.periode_ke,
        status: paymentMap[p.id] ?? 'pending',
      })),
    });
  }

  // Dampak ke pemenang berikutnya: setiap kabur member = pemenang terima lebih sedikit
  const kaburCount = debtors.filter((d) => d.total_hutang > 0).length;
  const memberCount = members?.length ?? 0;
  const expectedPerWinner = memberCount * group.nominal;
  const impactPerWinner = kaburCount * group.nominal;

  return c.json({
    debtors,
    member_count: memberCount,
    expected_per_winner: expectedPerWinner,
    actual_per_winner: expectedPerWinner - impactPerWinner,
    impact_per_winner: impactPerWinner,
  });
});

// POST /api/groups/:id/kabur/:memberId/resolve — ketua tutup hutang anggota kabur
// mode: 'kick_writeoff' (kick + catat kerugian) | 'netting' (offset hutang dengan pembayaran sebelumnya)
groupsRoute.post(
  '/:id/kabur/:memberId/resolve',
  zValidator('json', z.object({ mode: z.enum(['kick_writeoff', 'netting']) })),
  async (c) => {
    const ketuaId = c.get('userId');
    const groupId = c.req.param('id');
    const memberId = c.req.param('memberId');
    const { mode } = c.req.valid('json');

    const { data: group } = await supabase
      .from('groups')
      .select('ketua_id, name, nominal')
      .eq('id', groupId)
      .single();
    if (!group || group.ketua_id !== ketuaId)
      return c.json({ error: 'Hanya ketua yang bisa menyelesaikan hutang' }, 403);

    // Cek member masih ada di grup
    const { data: membership } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', memberId)
      .single();

    const { data: winner } = await supabase
      .from('winners')
      .select('period_id, periods!inner(periode_ke)')
      .eq('group_id', groupId)
      .eq('user_id', memberId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!winner) return c.json({ error: 'Anggota ini belum pernah menang undian' }, 400);

    const wonPeriode = (winner.periods as unknown as { periode_ke: number }).periode_ke;

    // Ambil semua hutang (pending/late setelah menang)
    const { data: periods } = await supabase
      .from('periods')
      .select('id, periode_ke')
      .eq('group_id', groupId)
      .in('status', ['active', 'closed'])
      .gt('periode_ke', wonPeriode);

    let totalWrittenOff = 0;

    if (mode === 'kick_writeoff') {
      // Hapus payment pending/late → catat sebagai kerugian grup
      for (const p of periods ?? []) {
        const { data: py } = await supabase
          .from('payments')
          .select('id, status')
          .eq('period_id', p.id)
          .eq('user_id', memberId)
          .maybeSingle();

        if (!py || py.status !== 'confirmed') {
          await supabase
            .from('payments')
            .upsert(
              { period_id: p.id, user_id: memberId, status: 'late' },
              { onConflict: 'period_id,user_id' }
            );
          totalWrittenOff += group.nominal;
        }
      }

      // Kick dari grup jika masih ada
      if (membership) {
        await supabase
          .from('group_members')
          .delete()
          .eq('group_id', groupId)
          .eq('user_id', memberId);
        await removeMemberFromChannel(groupId, memberId);
      }

      await gs.logActivity(
        groupId,
        ketuaId,
        'member_kicked',
        `Anggota kabur setelah menang periode ${wonPeriode}. Hutang Rp ${totalWrittenOff.toLocaleString('id')} dicatat sebagai kerugian grup.`
      );
    } else {
      // Netting: tandai semua hutang sebagai confirmed (offset dengan pembayaran sebelumnya)
      // Digunakan jika grup setuju "hutang saling hapus" — pemenang berikutnya terima lebih sedikit
      for (const p of periods ?? []) {
        const { data: py } = await supabase
          .from('payments')
          .select('status')
          .eq('period_id', p.id)
          .eq('user_id', memberId)
          .maybeSingle();

        if (!py || py.status !== 'confirmed') {
          await supabase.from('payments').upsert(
            {
              period_id: p.id,
              user_id: memberId,
              status: 'confirmed',
              confirmed_by: ketuaId,
              confirmed_at: new Date().toISOString(),
            },
            { onConflict: 'period_id,user_id' }
          );
          totalWrittenOff += group.nominal;
        }
      }

      if (membership) {
        await supabase
          .from('group_members')
          .delete()
          .eq('group_id', groupId)
          .eq('user_id', memberId);
        await removeMemberFromChannel(groupId, memberId);
      }

      await gs.logActivity(
        groupId,
        ketuaId,
        'hutang_netting',
        `Hutang anggota (menang P${wonPeriode}) di-netting. Rp ${totalWrittenOff.toLocaleString('id')} dianggap lunas — pemenang berikutnya terima lebih sedikit.`
      );
    }

    // Notif ke semua anggota
    const { data: allMembers } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);
    for (const m of allMembers ?? []) {
      insertNotification(
        m.user_id,
        'kabur_resolved',
        mode === 'kick_writeoff' ? '⚠ Anggota Kabur Ditangani' : '✓ Hutang Diselesaikan',
        mode === 'kick_writeoff'
          ? `Ketua telah mengeluarkan anggota yang kabur dari grup "${group.name}". Kerugian: Rp ${totalWrittenOff.toLocaleString('id')}.`
          : `Hutang anggota di grup "${group.name}" diselesaikan via netting. Pemenang berikutnya menerima lebih sedikit.`,
        { group_id: groupId }
      ).catch(() => {});
    }

    return c.json({
      message: 'Hutang berhasil diselesaikan',
      mode,
      total_resolved: totalWrittenOff,
    });
  }
);

// GET /api/groups/:id/buku — buku kas arisan: rekap keuangan per periode (buku catatan tradisional)
groupsRoute.get('/:id/buku', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('id');

  const { data: membership } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (!membership) return c.json({ error: 'Kamu bukan anggota grup ini' }, 403);

  const [{ data: group }, { data: members }, { data: periods }] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, nominal, jumlah_periode, ketua_id, status')
      .eq('id', groupId)
      .single(),
    supabase
      .from('group_members')
      .select('user_id, urutan, users!inner(name, phone)')
      .eq('group_id', groupId)
      .order('urutan', { nullsFirst: false }),
    supabase
      .from('periods')
      .select('id, periode_ke, status, jatuh_tempo, tanggal_pelaksanaan')
      .eq('group_id', groupId)
      .order('periode_ke'),
  ]);

  if (!group || !periods?.length) {
    return c.json({
      group,
      members: [],
      periods: [],
      summary: { total_collected: 0, total_expected: 0, collection_rate: 0 },
    });
  }

  const periodIds = periods.map((p) => p.id);

  const [{ data: allPayments }, { data: allWinners }] = await Promise.all([
    supabase
      .from('payments')
      .select('period_id, user_id, status, confirmed_by, confirmed_at')
      .in('period_id', periodIds),
    supabase.from('winners').select('period_id, user_id, created_at').eq('group_id', groupId),
  ]);

  // Ambil nama semua user_id yang terlibat (member + confirmer)
  const allUserIds = [
    ...new Set([
      ...(members ?? []).map((m) => m.user_id),
      ...(allPayments ?? []).filter((p) => p.confirmed_by).map((p) => p.confirmed_by as string),
      ...(allWinners ?? []).map((w) => w.user_id),
    ]),
  ];
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, name, phone')
    .in('id', allUserIds);
  const userMap: Record<string, string> = {};
  for (const u of allUsers ?? []) userMap[u.id] = u.name ?? u.phone ?? '—';

  const memberCount = members?.length ?? 0;
  const nominal = group.nominal ?? 0;

  const periodsData = periods.map((p) => {
    const payments = (allPayments ?? []).filter((py) => py.period_id === p.id);
    const winner = (allWinners ?? []).find((w) => w.period_id === p.id);
    const confirmedCount = payments.filter((py) => py.status === 'confirmed').length;

    return {
      period_id: p.id,
      period_number: p.periode_ke,
      status: p.status,
      due_date: p.jatuh_tempo,
      execution_date: p.tanggal_pelaksanaan,
      winner: winner
        ? {
            user_id: winner.user_id,
            name: userMap[winner.user_id] ?? '—',
            drawn_at: winner.created_at,
            amount_received: nominal * memberCount,
          }
        : null,
      payments: (members ?? []).map((m) => {
        const py = payments.find((x) => x.user_id === m.user_id);
        return {
          user_id: m.user_id,
          user_name: userMap[m.user_id] ?? '—',
          slot_order: m.urutan ?? null,
          status: py?.status ?? 'pending',
          confirmed_by_name: py?.confirmed_by ? (userMap[py.confirmed_by] ?? '—') : null,
          confirmed_at: py?.confirmed_at ?? null,
        };
      }),
      paid_count: confirmedCount,
      member_count: memberCount,
      total_collected: nominal * confirmedCount,
    };
  });

  const totalCollected = periodsData.reduce((s, p) => s + p.total_collected, 0);
  const totalExpected = nominal * memberCount * periods.length;

  return c.json({
    group: {
      id: group.id,
      name: group.name,
      nominal,
      total_periods: group.jumlah_periode,
      status: group.status,
      is_ketua: group.ketua_id === userId,
    },
    members: (members ?? []).map((m) => ({
      user_id: m.user_id,
      name: userMap[m.user_id] ?? '—',
      slot_order: m.urutan ?? null,
    })),
    periods: periodsData,
    summary: {
      total_collected: totalCollected,
      total_expected: totalExpected,
      collection_rate: totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0,
    },
  });
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
// Ketua bisa kapan saja. Pemenang undian periode ini bisa isi jika tanggal belum diset.
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

    const isKetua = group.ketua_id === userId;

    if (!isKetua) {
      // Cek apakah user adalah pemenang periode ini
      const { data: winner } = await supabase
        .from('winners')
        .select('id')
        .eq('period_id', periodId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!winner) {
        return c.json(
          { error: 'Hanya ketua atau pemenang undian yang bisa mengatur tanggal pelaksanaan' },
          403
        );
      }
    }

    const { data: period } = await supabase
      .from('periods')
      .select('id, status, tanggal_pelaksanaan')
      .eq('id', periodId)
      .eq('group_id', groupId)
      .single();

    if (!period) return c.json({ error: 'Periode tidak ditemukan' }, 404);
    if (period.status === 'completed')
      return c.json({ error: 'Tanggal tidak bisa diubah untuk periode yang sudah selesai' }, 400);

    // Pemenang hanya bisa isi tanggal jika belum ada (ketua bisa override kapan saja)
    if (!isKetua && period.tanggal_pelaksanaan) {
      return c.json({ error: 'Tanggal sudah diatur. Hubungi ketua jika perlu mengubahnya.' }, 400);
    }

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
    const actor = isKetua ? 'Ketua' : 'Pemenang';
    await gs.logActivity(
      groupId,
      userId,
      'tanggal_updated',
      `${actor} mengatur tanggal pelaksanaan: ${oldTanggal} → ${tanggal_pelaksanaan} (jatuh_tempo: ${jatuh_tempo})`
    );

    return c.json({ tanggal_pelaksanaan, jatuh_tempo });
  }
);

// DELETE /api/groups/:id/members/:memberId — ketua kick anggota paksa (termasuk saat aktif)
groupsRoute.delete('/:id/members/:memberId', async (c) => {
  const ketuaId = c.get('userId');
  const groupId = c.req.param('id');
  const memberId = c.req.param('memberId');

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id, name')
    .eq('id', groupId)
    .single();

  if (!group) return c.json({ error: 'Grup tidak ditemukan' }, 404);
  if (group.ketua_id !== ketuaId)
    return c.json({ error: 'Hanya ketua yang bisa mengeluarkan anggota' }, 403);
  if (memberId === ketuaId)
    return c.json({ error: 'Ketua tidak bisa mengeluarkan dirinya sendiri' }, 400);

  // Cek apakah anggota masih aktif di grup
  const { data: membership } = await supabase
    .from('group_members')
    .select('urutan')
    .eq('group_id', groupId)
    .eq('user_id', memberId)
    .single();
  if (!membership) return c.json({ error: 'Anggota tidak ditemukan di grup ini' }, 404);

  const isActive = !(await gs.isGroupEditable(groupId));

  if (isActive) {
    // Arisan sedang berjalan — hapus payment pending yang belum dikonfirmasi
    // (history late/confirmed tetap untuk audit trail)
    const { data: activePeriod } = await supabase
      .from('periods')
      .select('id')
      .eq('group_id', groupId)
      .eq('status', 'active')
      .maybeSingle();

    if (activePeriod) {
      await supabase
        .from('payments')
        .delete()
        .eq('period_id', activePeriod.id)
        .eq('user_id', memberId)
        .eq('status', 'pending');
    }
  }

  // Hapus dari grup
  await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', memberId);
  await removeMemberFromChannel(groupId, memberId);

  const reason = isActive
    ? 'Anggota dikeluarkan paksa oleh ketua (tidak aktif/tidak bayar)'
    : 'Anggota dikeluarkan oleh ketua';
  await gs.logActivity(groupId, ketuaId, 'member_kicked', reason);

  // Notifikasi ke anggota yang dikeluarkan
  sendExpoPush(
    memberId,
    'Kamu Dikeluarkan dari Grup',
    `Kamu telah dikeluarkan dari grup arisan "${group.name}" oleh ketua.`,
    { group_id: groupId }
  ).catch(() => {});

  return c.json({
    message: 'Anggota berhasil dikeluarkan dari grup',
    was_active: isActive,
  });
});

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

// POST /api/groups/:groupId/messages
groupsRoute.post(
  '/:groupId/messages',
  zValidator('json', z.object({ content: z.string().min(1).max(500) })),
  async (c) => {
    const userId = c.get('userId');
    const groupId = c.req.param('groupId');
    const { content } = c.req.valid('json');

    const { data: member } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (!member) return c.json({ error: 'Kamu bukan anggota grup ini' }, 403);

    const { data: msg, error } = await supabase
      .from('messages')
      .insert({ group_id: groupId, user_id: userId, content })
      .select('id, group_id, user_id, content, created_at, user:users!user_id(name, phone)')
      .single();

    if (error || !msg) return c.json({ error: 'Gagal mengirim pesan' }, 500);

    // Push notif ke semua anggota lain — fire-and-forget, tidak block response
    const senderName =
      (msg as unknown as { user?: { name?: string | null } }).user?.name ?? 'Anggota';
    void (async () => {
      const [{ data: otherMembers }, { data: groupRow }] = await Promise.all([
        supabase
          .from('group_members')
          .select('user_id')
          .eq('group_id', groupId)
          .neq('user_id', userId),
        supabase.from('groups').select('name').eq('id', groupId).single(),
      ]);
      if (!otherMembers) return;
      const groupName = groupRow?.name ?? 'Grup';
      for (const m of otherMembers) {
        await sendExpoPush(m.user_id, `💬 ${groupName}`, `${senderName}: ${content.slice(0, 80)}`, {
          screen: 'Chat',
          groupId,
        });
      }
    })();

    return c.json({ message: msg }, 201);
  }
);

// In-memory typing state: groupId → { userId → expiresAt }
// TTL 5 detik — cukup untuk debounce typing event mobile
const typingState = new Map<string, Map<string, number>>();

// POST /api/groups/:groupId/typing — broadcast "saya sedang mengetik"
groupsRoute.post('/:groupId/typing', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('groupId');

  const { data: membership } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (!membership) return c.json({ error: 'Bukan anggota grup' }, 403);

  if (!typingState.has(groupId)) typingState.set(groupId, new Map());
  typingState.get(groupId)!.set(userId, Date.now() + 5000);
  return c.json({ ok: true });
});

// GET /api/groups/:groupId/typing — ambil siapa yang sedang mengetik
groupsRoute.get('/:groupId/typing', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('groupId');

  const { data: membership } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (!membership) return c.json({ error: 'Bukan anggota grup' }, 403);

  const now = Date.now();
  const groupTyping = typingState.get(groupId) ?? new Map<string, number>();

  // Kumpulkan user yang masih dalam TTL, kecuali diri sendiri
  const activeTypers: string[] = [];
  for (const [uid, exp] of groupTyping.entries()) {
    if (exp > now && uid !== userId) activeTypers.push(uid);
    else if (exp <= now) groupTyping.delete(uid);
  }

  if (activeTypers.length === 0) return c.json({ typing: [] });

  // Ambil nama dari DB
  const { data: users } = await supabase
    .from('users')
    .select('id, name, phone')
    .in('id', activeTypers);
  const typing = (users ?? []).map((u) => ({ id: u.id, name: u.name ?? u.phone }));
  return c.json({ typing });
});
