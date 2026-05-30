import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { jwtAuth } from '../middleware/auth';
import * as ps from '../services/payments';
import { logActivity } from '../services/groups';
import { insertNotification } from '../services/notifications';
import { supabase } from '../db/supabase';

type Variables = { userId: string };

export const paymentsRoute = new Hono<{ Variables: Variables }>();

// Cron endpoint — dilindungi X-Cron-Secret saja, tidak butuh JWT.
// Didaftarkan SEBELUM /:groupId/:periodId agar tidak tertangkap sebagai param.
paymentsRoute.get('/cron/mark-late', async (c) => {
  if (c.req.header('X-Cron-Secret') !== process.env.CRON_SECRET)
    return c.json({ error: 'Unauthorized' }, 401);
  const updated = await ps.markLatePayments();
  return c.json({ updated, message: `${updated} pembayaran ditandai terlambat` });
});

paymentsRoute.use('*', jwtAuth);

const confirmSchema = z.object({ member_id: z.string().uuid() });

paymentsRoute.get('/:groupId/:periodId', async (c) => {
  const { periodId } = c.req.param();
  const data = await ps.getPeriodPaymentStatus(periodId);
  return c.json({ payments: data });
});

paymentsRoute.post('/:groupId/:periodId/confirm', zValidator('json', confirmSchema), async (c) => {
  const confirmedBy = c.get('userId');
  const { groupId, periodId } = c.req.param();
  const { member_id } = c.req.valid('json');

  const result = await ps.confirmPayment(periodId, member_id, confirmedBy);
  if (!result.success) return c.json({ error: result.reason }, 400);

  await logActivity(groupId, confirmedBy, 'payment_confirmed', 'Pembayaran anggota dikonfirmasi');

  // Notifikasi ke user yang dibayar — tidak throw jika gagal
  const { data: period } = await supabase
    .from('periods')
    .select('periode_ke')
    .eq('id', periodId)
    .single();
  insertNotification(
    member_id,
    'payment_confirmed',
    'Pembayaran Dikonfirmasi',
    `Pembayaran kamu untuk periode ${period?.periode_ke ?? ''} telah dikonfirmasi ketua.`,
    { group_id: groupId, period_id: periodId }
  ).catch(() => {});

  return c.json({ message: 'Pembayaran berhasil dikonfirmasi' });
});

paymentsRoute.delete(
  '/:groupId/:periodId/confirm',
  zValidator('json', confirmSchema),
  async (c) => {
    const confirmedBy = c.get('userId');
    const { groupId, periodId } = c.req.param();
    const { member_id } = c.req.valid('json');

    const result = await ps.cancelConfirmPayment(periodId, member_id, confirmedBy);
    if (!result.success) return c.json({ error: result.reason }, 400);

    await logActivity(
      groupId,
      confirmedBy,
      'payment_cancelled',
      'Konfirmasi pembayaran dibatalkan'
    );
    return c.json({ message: 'Konfirmasi pembayaran dibatalkan' });
  }
);
