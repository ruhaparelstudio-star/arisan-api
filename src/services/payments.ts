import { supabase } from '../db/supabase';

export async function getPeriodPaymentStatus(periodId: string) {
  const { data } = await supabase
    .from('payments')
    .select('*, users(id, name, phone)')
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
    .eq('id', period.group_id)
    .single();
  if (!group || group.ketua_id !== confirmedBy)
    return { success: false, reason: 'Hanya ketua yang bisa konfirmasi pembayaran' };

  await supabase.from('payments').upsert(
    {
      period_id: periodId,
      user_id: memberId,
      status: 'confirmed',
      confirmed_by: confirmedBy,
      confirmed_at: new Date(),
    },
    { onConflict: 'period_id,user_id' }
  );

  return { success: true };
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
    .eq('id', period.group_id)
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

export async function markLatePayments(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('payments')
    .select('id, period_id, periods!inner(jatuh_tempo)')
    .eq('status', 'pending')
    .lt('periods.jatuh_tempo', today);

  if (!data?.length) return 0;
  const ids = data.map((d) => d.id);
  await supabase.from('payments').update({ status: 'late' }).in('id', ids);
  return ids.length;
}
