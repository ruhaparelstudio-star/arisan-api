import { supabase } from '../db/supabase';
import { logActivity } from './groups';
import { sendWA, insertNotification } from './notifications';
import { logger } from '../utils/logger';

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
  // Max 2 swap approved per user per grup — cek requester dan target
  const [swapCount, targetSwapCount] = await Promise.all([
    getUserSwapCount(requesterId, groupId),
    getUserSwapCount(targetId, groupId),
  ]);
  if (swapCount >= 2) {
    return { error: 'Kamu sudah menggunakan jatah tukar giliran maksimal (2x) di grup ini' };
  }
  if (targetSwapCount >= 2) {
    return { error: 'Anggota yang kamu pilih sudah mencapai batas tukar giliran (2x) di grup ini' };
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
    .eq('periode_ke', requesterMember.urutan ?? 0)
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
    .eq('periode_ke', targetMember.urutan ?? 0)
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
  insertNotification(
    targetId,
    'swap_request',
    'Permintaan Tukar Giliran',
    'Ada anggota yang ingin menukar giliran arisan dengan kamu. Buka aplikasi untuk merespons.',
    { group_id: groupId, swap_id: (swap as Record<string, string>).id }
  ).catch((err) => logger.error('insertNotification failed (swap request)', { groupId, err }));

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

  // Terima status 'pending' (normal) DAN 'ketua_pending' (inisiasi ketua)
  if (swap.status !== 'pending' && swap.status !== 'ketua_pending') {
    return { error: 'Permintaan ini sudah tidak bisa direspons' };
  }

  if (response === 'rejected') {
    await supabase
      .from('swap_requests')
      .update({ status: 'rejected', target_response_at: new Date().toISOString() })
      .eq('id', swapId);
    await sendWA(swap.requester_id!, `Permintaan tukar giliran kamu ditolak.`);
    return { status: 'rejected' };
  }

  // Target accepted
  if (swap.status === 'ketua_pending') {
    // Ketua-initiated: auto-approve langsung, tidak perlu ketua approval step
    const { error: updateErr } = await supabase
      .from('swap_requests')
      .update({ status: 'approved', target_response_at: new Date().toISOString(), ketua_response_at: new Date().toISOString() })
      .eq('id', swapId);

    if (updateErr) return { error: 'Gagal memperbarui permintaan tukar giliran' };

    const { data: requesterMember } = await supabase
      .from('group_members')
      .select('urutan')
      .eq('group_id', swap.group_id!)
      .eq('user_id', swap.requester_id!)
      .single();
    const { data: targetMember } = await supabase
      .from('group_members')
      .select('urutan')
      .eq('group_id', swap.group_id!)
      .eq('user_id', swap.target_id!)
      .single();

    if (requesterMember && targetMember) {
      const { error: swapErr } = await supabase.rpc('swap_group_member_urutan', {
        p_group_id:  swap.group_id!,
        p_user_a_id: swap.requester_id!,
        p_user_b_id: swap.target_id!,
      });
      if (swapErr) {
        logger.error('swap_group_member_urutan RPC failed', { swapId, error: swapErr });
        return { error: 'Gagal menukar urutan giliran' };
      }
      await logActivity(
        swap.group_id!,
        swap.requester_id!,
        'swap_approved',
        `Tukar giliran (inisiatif ketua) disetujui: urutan ${requesterMember.urutan} ↔ ${targetMember.urutan}`
      );
    }

    await sendWA(swap.requester_id!, `Tukar giliran kamu disetujui! Urutan kamu telah diperbarui.`);
    const { data: grp } = await supabase
      .from('groups')
      .select('ketua_id')
      .eq('id', swap.group_id!)
      .single();
    if (grp?.ketua_id)
      await sendWA(
        grp.ketua_id,
        `Tukar giliran yang kamu inisiasi telah disetujui oleh anggota target.`
      );

    return { status: 'approved' };
  }

  // Normal flow: target menerima → waiting_ketua
  const { error } = await supabase
    .from('swap_requests')
    .update({ status: 'waiting_ketua', target_response_at: new Date().toISOString() })
    .eq('id', swapId);

  if (error) return { error: 'Gagal memperbarui permintaan tukar giliran' };

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id')
    .eq('id', swap.group_id!)
    .single();
  if (group?.ketua_id) {
    await sendWA(
      group.ketua_id,
      `Ada permintaan tukar giliran di grup arisan yang menunggu persetujuanmu. Buka aplikasi untuk menyetujui.`
    );
  }

  return { status: 'waiting_ketua' };
}

// Ketua-initiated swap (Mode 2): status 'ketua_pending' — target B respond, lalu auto-approved
// Tidak perlu kolom baru — pakai status string yang sudah ada (VARCHAR column)
export async function createKetuaSwapRequest(
  ketuaId: string,
  memberAId: string,
  memberBId: string,
  groupId: string
): Promise<{ swap?: Record<string, unknown>; error?: string }> {
  if (memberAId === memberBId) return { error: 'Pilih dua anggota yang berbeda' };

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id')
    .eq('id', groupId)
    .single();
  if (!group) return { error: 'Grup tidak ditemukan' };
  if (group.ketua_id !== ketuaId)
    return { error: 'Hanya ketua yang bisa menginisiasi tukar giliran ini' };

  for (const memberId of [memberAId, memberBId]) {
    const { data: member } = await supabase
      .from('group_members')
      .select('urutan')
      .eq('group_id', groupId)
      .eq('user_id', memberId)
      .single();
    if (!member) return { error: 'Salah satu anggota bukan member grup ini' };

    const { data: completedPeriod } = await supabase
      .from('periods')
      .select('id')
      .eq('group_id', groupId)
      .eq('periode_ke', member.urutan ?? 0)
      .eq('status', 'completed')
      .maybeSingle();
    if (completedPeriod)
      return { error: 'Salah satu anggota sudah melewati gilirannya, tidak bisa ditukar' };
  }

  // Cek tidak ada swap aktif antar keduanya
  const { data: existingSwap } = await supabase
    .from('swap_requests')
    .select('id')
    .eq('group_id', groupId)
    .or(
      `and(requester_id.eq.${memberAId},target_id.eq.${memberBId}),and(requester_id.eq.${memberBId},target_id.eq.${memberAId})`
    )
    .in('status', ['pending', 'ketua_pending', 'waiting_ketua'])
    .maybeSingle();
  if (existingSwap)
    return {
      error: 'Sudah ada permintaan tukar giliran yang sedang diproses antara dua anggota ini',
    };

  const { data: swap, error } = await supabase
    .from('swap_requests')
    .insert({
      group_id: groupId,
      requester_id: memberAId,
      target_id: memberBId,
      status: 'ketua_pending',
    })
    .select()
    .single();

  if (error || !swap) return { error: 'Gagal membuat permintaan tukar giliran' };

  await sendWA(
    memberBId,
    `Ketua grup arisan mengajukan tukar giliran antara kamu dan anggota lain. Buka aplikasi untuk merespons.`
  );

  return { swap: swap as Record<string, unknown> };
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
    .eq('id', swap.group_id!)
    .single();

  if (!group || group.ketua_id !== ketuaId) {
    return { error: 'Hanya ketua grup yang bisa menyetujui tukar giliran' };
  }

  const { error } = await supabase
    .from('swap_requests')
    .update({ status: decision, ketua_response_at: new Date().toISOString() })
    .eq('id', swapId);

  if (error) return { error: 'Gagal memperbarui status tukar giliran' };

  if (decision === 'approved') {
    // Tukar urutan di group_members
    const { data: requesterMember } = await supabase
      .from('group_members')
      .select('urutan')
      .eq('group_id', swap.group_id!)
      .eq('user_id', swap.requester_id!)
      .single();

    const { data: targetMember } = await supabase
      .from('group_members')
      .select('urutan')
      .eq('group_id', swap.group_id!)
      .eq('user_id', swap.target_id!)
      .single();

    if (requesterMember && targetMember) {
      const { error: swapErr } = await supabase.rpc('swap_group_member_urutan', {
        p_group_id:  swap.group_id!,
        p_user_a_id: swap.requester_id!,
        p_user_b_id: swap.target_id!,
      });
      if (swapErr) {
        logger.error('swap_group_member_urutan RPC failed', { swapId, error: swapErr });
        return { error: 'Gagal menukar urutan giliran' };
      }
      await logActivity(
        swap.group_id!,
        ketuaId,
        'swap_approved',
        `Tukar giliran disetujui: urutan ${requesterMember.urutan} ↔ ${targetMember.urutan}`
      );
    }

    await sendWA(
      swap.requester_id!,
      `Permintaan tukar giliran kamu disetujui oleh ketua. Giliran kamu telah diperbarui.`
    );
  } else {
    await sendWA(swap.requester_id!, `Permintaan tukar giliran kamu ditolak oleh ketua.`);
  }

  return { status: decision };
}
