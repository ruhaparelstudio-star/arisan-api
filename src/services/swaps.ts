import { supabase } from '../db/supabase';
import { logActivity } from './groups';
import { sendWA } from './notifications';

export async function getUserSwapCount(userId: string, groupId: string): Promise<number> {
  const { count } = await supabase
    .from('swap_requests')
    .select('*', { count: 'exact', head: true })
    .eq('requester_id', userId)
    .eq('group_id', groupId)
    .eq('status', 'approved');
  return count ?? 0;
}

export async function createSwapRequest(
  requesterId: string,
  targetId: string,
  groupId: string
): Promise<{ swap?: Record<string, unknown>; error?: string }> {
  // Max 2 swap approved per user per grup
  const swapCount = await getUserSwapCount(requesterId, groupId);
  if (swapCount >= 2) {
    return { error: 'Kamu sudah menggunakan jatah tukar giliran maksimal (2x) di grup ini' };
  }

  // Tidak ada pending swap dari requester di grup ini
  const { data: pending } = await supabase
    .from('swap_requests')
    .select('id')
    .eq('requester_id', requesterId)
    .eq('group_id', groupId)
    .eq('status', 'pending')
    .maybeSingle();
  if (pending) {
    return { error: 'Kamu masih punya permintaan tukar giliran yang belum selesai di grup ini' };
  }

  // Requester punya giliran yang belum berlangsung
  const { data: requesterMember } = await supabase
    .from('group_members')
    .select('urutan')
    .eq('group_id', groupId)
    .eq('user_id', requesterId)
    .single();
  if (!requesterMember) return { error: 'Kamu bukan anggota grup ini' };

  const { data: requesterPeriod } = await supabase
    .from('periods')
    .select('id')
    .eq('group_id', groupId)
    .eq('periode_ke', requesterMember.urutan)
    .eq('status', 'completed')
    .maybeSingle();
  if (requesterPeriod) {
    return { error: 'Giliran kamu sudah berlangsung, tidak bisa ditukar lagi' };
  }

  // Target punya giliran yang belum berlangsung
  const { data: targetMember } = await supabase
    .from('group_members')
    .select('urutan')
    .eq('group_id', groupId)
    .eq('user_id', targetId)
    .single();
  if (!targetMember) return { error: 'User target bukan anggota grup ini' };

  const { data: targetPeriod } = await supabase
    .from('periods')
    .select('id')
    .eq('group_id', groupId)
    .eq('periode_ke', targetMember.urutan)
    .eq('status', 'completed')
    .maybeSingle();
  if (targetPeriod) {
    return { error: 'Giliran target sudah berlangsung, tidak bisa ditukar' };
  }

  const { data: swap, error } = await supabase
    .from('swap_requests')
    .insert({ group_id: groupId, requester_id: requesterId, target_id: targetId })
    .select()
    .single();

  if (error || !swap) return { error: 'Gagal membuat permintaan tukar giliran' };

  await sendWA(
    targetId,
    `Ada permintaan tukar giliran arisan untukmu. Buka aplikasi untuk merespons.`
  );

  return { swap: swap as Record<string, unknown> };
}

export async function respondSwap(
  swapId: string,
  targetId: string,
  response: 'accepted' | 'rejected'
): Promise<{ status?: string; error?: string }> {
  const { data: swap } = await supabase.from('swap_requests').select('*').eq('id', swapId).single();

  if (!swap) return { error: 'Permintaan tukar giliran tidak ditemukan' };
  if (swap.target_id !== targetId) return { error: 'Kamu bukan target dari permintaan ini' };
  if (swap.status !== 'pending') return { error: 'Permintaan ini sudah tidak bisa direspons' };

  const newStatus = response === 'accepted' ? 'waiting_ketua' : 'rejected';

  const { error } = await supabase
    .from('swap_requests')
    .update({ status: newStatus, target_response_at: new Date() })
    .eq('id', swapId);

  if (error) return { error: 'Gagal memperbarui permintaan tukar giliran' };

  if (response === 'accepted') {
    const { data: group } = await supabase
      .from('groups')
      .select('ketua_id')
      .eq('id', swap.group_id)
      .single();

    if (group?.ketua_id) {
      await sendWA(
        group.ketua_id,
        `Ada permintaan tukar giliran di grup arisan yang menunggu persetujuanmu. Buka aplikasi untuk menyetujui.`
      );
    }
  } else {
    await sendWA(swap.requester_id, `Permintaan tukar giliran kamu ditolak oleh target.`);
  }

  return { status: newStatus };
}

export async function approveSwap(
  swapId: string,
  ketuaId: string,
  decision: 'approved' | 'ketua_rejected'
): Promise<{ status?: string; error?: string }> {
  const { data: swap } = await supabase.from('swap_requests').select('*').eq('id', swapId).single();

  if (!swap) return { error: 'Permintaan tukar giliran tidak ditemukan' };
  if (swap.status !== 'waiting_ketua') return { error: 'Permintaan ini sudah tidak bisa diproses' };

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id')
    .eq('id', swap.group_id)
    .single();

  if (!group || group.ketua_id !== ketuaId) {
    return { error: 'Hanya ketua grup yang bisa menyetujui tukar giliran' };
  }

  const { error } = await supabase
    .from('swap_requests')
    .update({ status: decision, ketua_response_at: new Date() })
    .eq('id', swapId);

  if (error) return { error: 'Gagal memperbarui status tukar giliran' };

  if (decision === 'approved') {
    // Tukar urutan di group_members
    const { data: requesterMember } = await supabase
      .from('group_members')
      .select('urutan')
      .eq('group_id', swap.group_id)
      .eq('user_id', swap.requester_id)
      .single();

    const { data: targetMember } = await supabase
      .from('group_members')
      .select('urutan')
      .eq('group_id', swap.group_id)
      .eq('user_id', swap.target_id)
      .single();

    if (requesterMember && targetMember) {
      await supabase
        .from('group_members')
        .update({ urutan: targetMember.urutan })
        .eq('group_id', swap.group_id)
        .eq('user_id', swap.requester_id);

      await supabase
        .from('group_members')
        .update({ urutan: requesterMember.urutan })
        .eq('group_id', swap.group_id)
        .eq('user_id', swap.target_id);

      await logActivity(
        swap.group_id,
        ketuaId,
        'swap_approved',
        `Tukar giliran disetujui: urutan ${requesterMember.urutan} ↔ ${targetMember.urutan}`
      );
    }

    await sendWA(
      swap.requester_id,
      `Permintaan tukar giliran kamu disetujui oleh ketua. Giliran kamu telah diperbarui.`
    );
  } else {
    await sendWA(swap.requester_id, `Permintaan tukar giliran kamu ditolak oleh ketua.`);
  }

  return { status: decision };
}
