import { Hono } from 'hono';
import { z } from 'zod';
import { zv } from '../utils/zv';
import { jwtAuth } from '../middleware/auth';
import * as ps from '../services/payments';
import { logActivity } from '../services/groups';
import { insertNotification } from '../services/notifications';
import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { createHmac, timingSafeEqual } from 'crypto';

function verifyCronRequest(
  secret: string | undefined,
  signature: string | undefined,
  timestamp: string | undefined
): boolean {
  if (!secret) return false;

  // Legacy: plain secret header (backward compat selama transisi)
  if (!signature && !timestamp) {
    return false; // plain-secret mode sudah dihapus
  }

  if (!signature || !timestamp) return false;

  // Tolak timestamp lebih dari 5 menit yang lalu (replay attack prevention)
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}:cron`).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

type Variables = { userId: string };

export const paymentsRoute = new Hono<{ Variables: Variables }>();

// Cron endpoint — dilindungi X-Cron-Secret saja, tidak butuh JWT.
// Didaftarkan SEBELUM /:groupId/:periodId agar tidak tertangkap sebagai param.
paymentsRoute.get('/cron/mark-late', async (c) => {
  const ok = verifyCronRequest(
    process.env.CRON_SECRET,
    c.req.header('X-Cron-Signature'),
    c.req.header('X-Cron-Timestamp')
  );
  if (!ok) return c.json({ error: 'Unauthorized' }, 401);
  const updated = await ps.markLatePayments();
  // Notifikasi ketua setiap grup yang ada payment terlambat — fire-and-forget
  ps.notifyKetuasOfLatePayments().catch((err) => logger.error('notifyKetuasOfLatePayments failed', { err }));
  return c.json({ updated, message: `${updated} pembayaran ditandai terlambat` });
});

paymentsRoute.use('*', jwtAuth);

const confirmSchema = z.object({ member_id: z.string().uuid() });

paymentsRoute.get('/:groupId/:periodId', async (c) => {
  const userId = c.get('userId');
  const { groupId, periodId } = c.req.param();

  const { data: member } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .single();
  if (!member) return c.json({ error: 'Kamu bukan anggota grup ini' }, 403);

  const { data: period } = await supabase
    .from('periods')
    .select('id')
    .eq('id', periodId)
    .eq('group_id', groupId)
    .single();
  if (!period) return c.json({ error: 'Periode tidak ditemukan' }, 404);

  const data = await ps.getPeriodPaymentStatus(periodId);
  return c.json({ payments: data });
});

paymentsRoute.post('/:groupId/:periodId/confirm', zv('json', confirmSchema), async (c) => {
  const confirmedBy = c.get('userId');
  const { groupId, periodId } = c.req.param();
  const { member_id } = c.req.valid('json');

  const result = await ps.confirmPayment(periodId, member_id, confirmedBy);
  if (!result.success) return c.json({ error: result.reason }, 400);

  await logActivity(groupId, confirmedBy, 'payment_confirmed', 'Pembayaran anggota dikonfirmasi');

  // Notifikasi hanya untuk konfirmasi baru (bukan re-konfirmasi upsert)
  if (result.isNew) {
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
    ).catch((err) => logger.error('insertNotification failed (payment confirmed)', { groupId, periodId, err }));
  }

  return c.json({ message: 'Pembayaran berhasil dikonfirmasi' });
});

paymentsRoute.delete('/:groupId/:periodId/confirm', zv('json', confirmSchema), async (c) => {
  const confirmedBy = c.get('userId');
  const { groupId, periodId } = c.req.param();
  const { member_id } = c.req.valid('json');

  const result = await ps.cancelConfirmPayment(periodId, member_id, confirmedBy);
  if (!result.success) return c.json({ error: result.reason }, 400);

  await logActivity(groupId, confirmedBy, 'payment_cancelled', 'Konfirmasi pembayaran dibatalkan');
  return c.json({ message: 'Konfirmasi pembayaran dibatalkan' });
});
