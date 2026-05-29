import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';

export async function generateInviteCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  let exists = true;
  do {
    code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join(
      ''
    );
    const { data } = await supabase.from('groups').select('id').eq('invite_code', code).single();
    exists = !!data;
  } while (exists);
  return code;
}

export async function canUserJoinOrCreate(
  userId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const { count } = await supabase
    .from('group_members')
    .select('*, groups!inner(status)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('groups.status', ['recruiting', 'active']);

  if ((count ?? 0) >= 3) {
    return {
      allowed: false,
      reason:
        'Kamu sudah bergabung di 3 grup aktif. Selesaikan atau keluar dari grup yang ada dulu.',
    };
  }
  return { allowed: true };
}

export async function isGroupEditable(groupId: string): Promise<boolean> {
  const { count } = await supabase
    .from('periods')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .in('status', ['active', 'completed']);
  return (count ?? 0) === 0;
}

export async function invalidateInviteCode(groupId: string): Promise<void> {
  await supabase
    .from('groups')
    .update({ invite_code: null, invite_code_expires_at: null })
    .eq('id', groupId);
}

export async function logActivity(
  groupId: string,
  actorId: string,
  action: string,
  description: string
): Promise<void> {
  const { error } = await supabase
    .from('activity_log')
    .insert({ group_id: groupId, actor_id: actorId, action, description });
  if (error) logger.error('logActivity failed', { groupId, action, error });
}
