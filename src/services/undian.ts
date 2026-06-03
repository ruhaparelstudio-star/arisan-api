import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { sendSystemMessage } from './streamio';
import { insertNotification } from './notifications';

export async function undianFixed(
  groupId: string,
  periodeKe: number
): Promise<{ user_id: string; name: string } | null> {
  const { data } = await supabase
    .from('group_members')
    .select('user_id, users(name)')
    .eq('group_id', groupId)
    .eq('urutan', periodeKe)
    .single();

  if (!data) return null;
  const users = data.users as unknown as { name: string } | { name: string }[] | null;
  const name = Array.isArray(users) ? (users[0]?.name ?? '') : (users?.name ?? '');
  return { user_id: data.user_id, name };
}

export async function undianRandom(groupId: string): Promise<string | null> {
  // Pakai PostgreSQL RANDOM() via RPC — bukan Math.random()
  // Fungsi undian_random harus dibuat di Supabase SQL Editor:
  //
  // CREATE OR REPLACE FUNCTION undian_random(p_group_id UUID) RETURNS UUID AS $$
  //   SELECT gm.user_id FROM group_members gm
  //   WHERE gm.group_id = p_group_id
  //   AND gm.user_id NOT IN (
  //     SELECT w.user_id FROM winners w WHERE w.group_id = p_group_id
  //   )
  //   ORDER BY RANDOM() LIMIT 1;
  // $$ LANGUAGE SQL;

  const { data, error } = await supabase.rpc('undian_random', { p_group_id: groupId });
  if (error) {
    logger.error('undianRandom RPC failed', { groupId, error });
    return null;
  }
  if (data) return data as string;

  // Fallback: semua anggota sudah pernah menang (multi-putaran arisan).
  // Pilih acak dari semua anggota aktif.
  const { data: members } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);
  if (!members?.length) return null;
  const idx = Math.floor(Math.random() * members.length);
  return members[idx].user_id;
}

export async function undianManual(winnerId: string): Promise<{ user_id: string }> {
  return { user_id: winnerId };
}

export async function saveWinner(groupId: string, periodId: string, userId: string): Promise<void> {
  // INSERT ONLY — tidak ada update/delete
  const { error } = await supabase
    .from('winners')
    .insert({ group_id: groupId, period_id: periodId, user_id: userId });
  if (error) logger.error('saveWinner failed', { groupId, periodId, userId, error });
}

/**
 * Auto-lunas netting: ketika W menang periode N, semua anggota yang pernah menang
 * di periode < N otomatis dianggap lunas untuk periode N.
 * Alasan: mereka sudah menerima uang dari W sebelumnya; hutang saling offset.
 */
export async function autoConfirmNetting(
  groupId: string,
  periodId: string,
  currentPeriodeKe: number,
  currentWinnerId: string,
  ketuaId: string,
  groupName: string
): Promise<void> {
  // Ambil semua pemenang periode sebelumnya yang masih anggota aktif
  const { data: prevWinners } = await supabase
    .from('winners')
    .select('user_id, periods!inner(periode_ke)')
    .eq('group_id', groupId)
    .lt('periods.periode_ke', currentPeriodeKe);

  if (!prevWinners?.length) return;

  // Filter hanya yang masih aktif di grup (belum di-kick)
  const { data: activeMembers } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);

  const activeMemberSet = new Set((activeMembers ?? []).map((m) => m.user_id));
  const eligiblePrevWinners = prevWinners.filter(
    (w) => activeMemberSet.has(w.user_id) && w.user_id !== currentWinnerId
  );

  if (!eligiblePrevWinners.length) return;

  const now = new Date().toISOString();

  // Upsert payment confirmed untuk masing-masing pemenang lama
  await supabase.from('payments').upsert(
    eligiblePrevWinners.map((w) => ({
      period_id: periodId,
      user_id: w.user_id,
      status: 'confirmed',
      confirmed_by: ketuaId,
      confirmed_at: now,
    })),
    { onConflict: 'period_id,user_id' }
  );

  // Notifikasi ke masing-masing pemenang lama
  for (const w of eligiblePrevWinners) {
    const periodeKe = (w.periods as unknown as { periode_ke: number }).periode_ke;
    await insertNotification(
      w.user_id,
      'payment_auto_lunas',
      '✓ Tagihan Otomatis Lunas',
      `Tagihan kamu di periode ${currentPeriodeKe} grup "${groupName}" otomatis lunas. Kamu pernah menang di periode ${periodeKe}, sehingga hutang saling netting dengan pemenang baru.`,
      { group_id: groupId, period_id: periodId }
    ).catch(() => {});
  }

  logger.info('autoConfirmNetting', {
    groupId,
    periodId,
    currentPeriodeKe,
    netted: eligiblePrevWinners.length,
  });
}

export async function broadcastUndianResult(
  groupId: string,
  winnerName: string,
  periodeKe: number
): Promise<void> {
  await sendSystemMessage(groupId, `🎉 Pemenang Periode ${periodeKe}: *${winnerName}*!`);
}
