import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { sendSystemMessage } from './streamio';

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
  return data as string | null;
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

export async function broadcastUndianResult(
  groupId: string,
  winnerName: string,
  periodeKe: number
): Promise<void> {
  await sendSystemMessage(groupId, `🎉 Pemenang Periode ${periodeKe}: *${winnerName}*!`);
  // TODO BE-6: tambah push notif setelah notifications service selesai
}
