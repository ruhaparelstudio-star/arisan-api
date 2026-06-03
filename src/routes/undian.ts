import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { jwtAuth } from '../middleware/auth';
import { supabase } from '../db/supabase';
import * as us from '../services/undian';
import { logActivity } from '../services/groups';
import { insertNotification } from '../services/notifications';

type Variables = { userId: string };

export const undianRoute = new Hono<{ Variables: Variables }>();

undianRoute.use('*', jwtAuth);

// GET /api/groups/:id/winners — riwayat pemenang
undianRoute.get('/:id/winners', async (c) => {
  const groupId = c.req.param('id');

  const [{ data }, { data: group }] = await Promise.all([
    supabase
      .from('winners')
      .select('id, user_id, created_at, period_id, periods(periode_ke), users(name, phone)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false }),
    supabase.from('groups').select('nominal, jumlah_periode').eq('id', groupId).single(),
  ]);

  const arisanAmount = group ? group.nominal * group.jumlah_periode : 0;

  const winners = (data ?? []).map((w) => ({ ...w, arisan_amount: arisanAmount }));
  return c.json({ winners });
});

const undianSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('fixed'), period_id: z.string().uuid() }),
  z.object({ mode: z.literal('random'), period_id: z.string().uuid() }),
  z.object({
    mode: z.literal('manual'),
    period_id: z.string().uuid(),
    winner_id: z.string().uuid(),
  }),
]);

// POST /api/groups/:id/undian
undianRoute.post('/:id/undian', zValidator('json', undianSchema), async (c) => {
  const ketuaId = c.get('userId');
  const groupId = c.req.param('id');
  const body = c.req.valid('json');

  // Validasi grup dan ketua
  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id, name, mode_undian')
    .eq('id', groupId)
    .single();

  if (!group) return c.json({ error: 'Grup tidak ditemukan' }, 404);
  if (group.ketua_id !== ketuaId)
    return c.json({ error: 'Hanya ketua yang bisa melakukan undian' }, 403);
  if (body.mode !== group.mode_undian)
    return c.json(
      { error: `Mode undian tidak sesuai. Grup ini menggunakan mode "${group.mode_undian}".` },
      400
    );

  // Validasi periode aktif
  const { data: period } = await supabase
    .from('periods')
    .select('id, periode_ke, status')
    .eq('id', body.period_id)
    .eq('group_id', groupId)
    .single();

  if (!period) return c.json({ error: 'Periode tidak ditemukan' }, 404);
  if (period.status !== 'active') return c.json({ error: 'Periode tidak aktif' }, 400);

  // Validasi belum ada winner untuk periode ini
  const { data: existingWinner } = await supabase
    .from('winners')
    .select('id')
    .eq('period_id', body.period_id)
    .eq('group_id', groupId)
    .single();

  if (existingWinner) return c.json({ error: 'Undian untuk periode ini sudah dilakukan' }, 400);

  // Jalankan undian sesuai mode
  let winnerId: string | null = null;
  let winnerName = '';

  if (body.mode === 'fixed') {
    const member = await us.undianFixed(groupId, period.periode_ke);
    if (!member) return c.json({ error: 'Tidak ada anggota dengan urutan ini' }, 400);
    winnerId = member.user_id;
    winnerName = member.name;
  } else if (body.mode === 'random') {
    winnerId = await us.undianRandom(groupId);
    if (!winnerId)
      return c.json({ error: 'Tidak ada anggota yang memenuhi syarat untuk undian' }, 400);

    const { data: winnerUser } = await supabase
      .from('users')
      .select('name, phone')
      .eq('id', winnerId)
      .single();
    winnerName = winnerUser?.name || winnerUser?.phone || 'anggota';
  } else {
    // manual
    const { data: manualUser } = await supabase
      .from('users')
      .select('name')
      .eq('id', body.winner_id)
      .single();

    if (!manualUser) return c.json({ error: 'User pemenang tidak ditemukan' }, 404);

    const { data: isMember } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', groupId)
      .eq('user_id', body.winner_id)
      .single();

    if (!isMember) return c.json({ error: 'User bukan anggota grup ini' }, 400);

    const result = await us.undianManual(body.winner_id);
    winnerId = result.user_id;
    winnerName = manualUser.name;
  }

  // Simpan winner — INSERT ONLY
  await us.saveWinner(groupId, body.period_id, winnerId);

  // NOTE: netting hutang (autoConfirmNetting) TIDAK dijalankan otomatis karena
  // akan mengurangi jumlah yang diterima pemenang berikutnya secara tidak adil.
  // Netting hanya dilakukan manual oleh ketua via endpoint resolveKabur.

  // Broadcast ke Stream.io — tidak throw jika gagal
  await us.broadcastUndianResult(groupId, winnerName, period.periode_ke);

  await logActivity(groupId, ketuaId, 'undian', `Undian mode ${body.mode}: pemenang ${winnerName}`);

  // Notifikasi ke semua anggota — fire-and-forget, tidak throw
  void (async () => {
    const { data: members } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);
    if (!members) return;
    for (const m of members) {
      const isWinner = m.user_id === winnerId;
      await insertNotification(
        m.user_id,
        'undian_done',
        isWinner ? 'Kamu Menang Undian!' : 'Undian Selesai',
        isWinner
          ? `Selamat! Kamu adalah pemenang undian periode ${period.periode_ke} di grup ${group.name}.`
          : `Undian periode ${period.periode_ke} di grup ${group.name} selesai. Pemenang: ${winnerName}.`,
        { group_id: groupId, period_id: body.period_id, winner_id: winnerId }
      ).catch(() => {});
    }
  })();

  return c.json({
    winner: { id: winnerId, name: winnerName },
    periode_ke: period.periode_ke,
  });
});
