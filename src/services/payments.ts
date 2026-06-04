import { supabase } from '../db/supabase';
import { insertNotification } from './notifications';
import { logger } from '../utils/logger';

export async function getPeriodPaymentStatus(periodId: string) {
  const { data } = await supabase
    .from('payments')
    .select('*, users!user_id(id, name)')
    .eq('period_id', periodId)
    .order('status');
  return data ?? [];
}

export async function confirmPayment(periodId: string, memberId: string, confirmedBy: string) {
  const { data: period } = await supabase
    .from('periods')
    .select('group_id, status')
    .eq('id', periodId)
    .single();
  if (!period || period.status !== 'active')
    return { success: false, reason: 'Periode tidak aktif' };

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id')
    .eq('id', period.group_id!)
    .single();
  if (!group || group.ketua_id !== confirmedBy)
    return { success: false, reason: 'Hanya ketua yang bisa konfirmasi pembayaran' };

  const { data: membership } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', period.group_id!)
    .eq('user_id', memberId)
    .single();
  if (!membership) return { success: false, reason: 'Anggota tidak ditemukan di grup ini' };

  const { data: existing } = await supabase
    .from('payments')
    .select('status')
    .eq('period_id', periodId)
    .eq('user_id', memberId)
    .maybeSingle();

  const isNew = !existing || existing.status !== 'confirmed';

  await supabase.from('payments').upsert(
    {
      period_id: periodId,
      user_id: memberId,
      status: 'confirmed',
      confirmed_by: confirmedBy,
      confirmed_at: new Date().toISOString(),
    },
    { onConflict: 'period_id,user_id' }
  );

  return { success: true, isNew };
}

export async function cancelConfirmPayment(
  periodId: string,
  memberId: string,
  confirmedBy: string
) {
  const { data: period } = await supabase
    .from('periods')
    .select('group_id, status')
    .eq('id', periodId)
    .single();
  if (!period || period.status !== 'active')
    return { success: false, reason: 'Periode tidak aktif' };

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id')
    .eq('id', period.group_id!)
    .single();
  if (!group || group.ketua_id !== confirmedBy)
    return { success: false, reason: 'Hanya ketua yang bisa membatalkan konfirmasi' };

  await supabase.from('payments').upsert(
    {
      period_id: periodId,
      user_id: memberId,
      status: 'pending',
      confirmed_by: null,
      confirmed_at: null,
    },
    { onConflict: 'period_id,user_id' }
  );

  return { success: true };
}

// Notifikasi ke ketua setiap grup yang punya anggota belum bayar lewat jatuh tempo
export async function notifyKetuasOfLatePayments(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  const { data: overduePeriods } = await supabase
    .from('periods')
    .select('id, group_id, jatuh_tempo, groups!inner(name, ketua_id)')
    .eq('status', 'active')
    .lt('jatuh_tempo', today);

  for (const period of overduePeriods ?? []) {
    const group = period.groups as unknown as { name: string; ketua_id: string };

    const [{ data: allMembers }, { data: confirmed }] = await Promise.all([
      supabase.from('group_members').select('user_id').eq('group_id', period.group_id!),
      supabase
        .from('payments')
        .select('user_id')
        .eq('period_id', period.id)
        .eq('status', 'confirmed'),
    ]);

    const confirmedSet = new Set((confirmed ?? []).map((p) => p.user_id));
    const unpaidCount = (allMembers ?? []).filter((m) => !confirmedSet.has(m.user_id)).length;

    if (unpaidCount > 0) {
      await insertNotification(
        group.ketua_id,
        'payment_late',
        '⚠ Ada Anggota Belum Bayar',
        `${unpaidCount} anggota belum bayar di grup "${group.name}". Jatuh tempo sudah terlewat. Ketuk untuk tindak lanjuti.`,
        { group_id: period.group_id, period_id: period.id }
      ).catch((err) => logger.error('insertNotification failed (payment late)', { periodId: period.id, err }));
    }
  }
}

export async function markLatePayments(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  // Step 1: tandai record pending yang sudah lewat jatuh tempo
  const { data: existing } = await supabase
    .from('payments')
    .select('id, period_id, periods!inner(jatuh_tempo)')
    .eq('status', 'pending')
    .lt('periods.jatuh_tempo', today);

  let updated = 0;
  if (existing?.length) {
    const ids = existing.map((d) => d.id);
    await supabase.from('payments').update({ status: 'late' }).in('id', ids);
    updated += ids.length;
  }

  // Step 2: buat record late untuk anggota yang SAMA SEKALI belum punya payment
  // pada periode yang sudah lewat jatuh tempo — jangan sentuh confirmed/late yang ada
  const { data: overduePeriods } = await supabase
    .from('periods')
    .select('id, group_id')
    .eq('status', 'active')
    .lt('jatuh_tempo', today);

  for (const period of overduePeriods ?? []) {
    const [{ data: members }, { data: paidMembers }] = await Promise.all([
      supabase.from('group_members').select('user_id').eq('group_id', period.group_id!),
      supabase.from('payments').select('user_id').eq('period_id', period.id),
    ]);

    const paidSet = new Set((paidMembers ?? []).map((p) => p.user_id));
    const unpaid = (members ?? []).filter((m) => !paidSet.has(m.user_id));

    if (unpaid.length) {
      await supabase
        .from('payments')
        .upsert(
          unpaid.map((m) => ({ period_id: period.id, user_id: m.user_id, status: 'late' })),
          { onConflict: 'period_id,user_id', ignoreDuplicates: true }
        );
      updated += unpaid.length;
    }
  }

  return updated;
}
