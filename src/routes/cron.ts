import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { createHmac, timingSafeEqual } from 'crypto';
import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';
import { sendWithDedup } from '../services/notifications';

export const cronRoute = new Hono();

function verifyCronHmac(
  secret: string | undefined,
  signature: string | undefined,
  timestamp: string | undefined
): boolean {
  if (!secret || !signature || !timestamp) return false;
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}:cron`).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

const cronAuth = createMiddleware(async (c, next) => {
  const ok = verifyCronHmac(
    process.env.CRON_SECRET,
    c.req.header('X-Cron-Signature'),
    c.req.header('X-Cron-Timestamp')
  );
  if (!ok) return c.json({ error: 'Akses tidak diizinkan' }, 401);
  return next();
});

cronRoute.use('*', cronAuth);

// GET /api/cron/payment-reminder
// Cari payments pending dengan jatuh_tempo = hari ini atau 3 hari lagi, kirim notif
cronRoute.get('/payment-reminder', async (c) => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const threeDaysLater = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const { data: relevantPeriods, error: periodError } = await supabase
    .from('periods')
    .select('id, jatuh_tempo, periode_ke')
    .in('jatuh_tempo', [todayStr, threeDaysLater]);

  if (periodError) {
    logger.error('Cron payment-reminder: query periods gagal', { error: periodError });
    return c.json({ error: 'Gagal mengambil data periode' }, 500);
  }

  if (!relevantPeriods?.length) {
    return c.json({ ok: true, sent: 0 });
  }

  const periodIds = relevantPeriods.map((p) => p.id);
  const periodMap = new Map(relevantPeriods.map((p) => [p.id, p]));

  const { data: payments, error: paymentError } = await supabase
    .from('payments')
    .select('user_id, period_id')
    .eq('status', 'pending')
    .in('period_id', periodIds);

  if (paymentError) {
    logger.error('Cron payment-reminder: query payments gagal', { error: paymentError });
    return c.json({ error: 'Gagal mengambil data pembayaran' }, 500);
  }

  let sent = 0;
  for (const payment of payments ?? []) {
    const period = periodMap.get(payment.period_id!);
    if (!period) continue;

    const isToday = period.jatuh_tempo === todayStr;
    const dueLabel = isToday ? 'hari ini' : '3 hari lagi';

    await sendWithDedup(
      payment.user_id!,
      `payment-reminder-${payment.period_id}`,
      {
        title: 'Pengingat Pembayaran Arisan',
        body: `Jatuh tempo pembayaran periode ke-${period.periode_ke} adalah ${dueLabel}.`,
      },
      `Halo! Jatuh tempo pembayaran arisan periode ke-${period.periode_ke} adalah ${dueLabel} (${period.jatuh_tempo}). Segera lakukan pembayaran ya.`
    );
    sent++;
  }

  logger.info('Cron payment-reminder selesai', { sent });
  return c.json({ ok: true, sent });
});

// GET /api/cron/pelaksanaan-reminder
// Cari periods dengan tanggal_pelaksanaan = 7 hari lagi, kirim notif ke semua anggota grup
cronRoute.get('/pelaksanaan-reminder', async (c) => {
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: periods, error: periodError } = await supabase
    .from('periods')
    .select('id, group_id, periode_ke, tanggal_pelaksanaan')
    .eq('tanggal_pelaksanaan', sevenDaysLater);

  if (periodError) {
    logger.error('Cron pelaksanaan-reminder: query periods gagal', { error: periodError });
    return c.json({ error: 'Gagal mengambil data periode' }, 500);
  }

  if (!periods?.length) {
    return c.json({ ok: true, sent: 0 });
  }

  let sent = 0;
  for (const period of periods) {
    const { data: members, error: memberError } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', period.group_id!);

    if (memberError) {
      logger.error('Cron pelaksanaan-reminder: query members gagal', {
        groupId: period.group_id,
        error: memberError,
      });
      continue;
    }

    for (const member of members ?? []) {
      await sendWithDedup(
        member.user_id!,
        `pelaksanaan-reminder-${period.id}`,
        {
          title: 'Pengingat Pelaksanaan Arisan',
          body: `Pelaksanaan arisan periode ke-${period.periode_ke} 7 hari lagi (${period.tanggal_pelaksanaan}).`,
        },
        `Halo! Pelaksanaan arisan periode ke-${period.periode_ke} akan dilakukan pada ${period.tanggal_pelaksanaan} (7 hari lagi). Pastikan hadir ya.`
      );
      sent++;
    }
  }

  logger.info('Cron pelaksanaan-reminder selesai', { sent });
  return c.json({ ok: true, sent });
});

// GET /api/cron/cleanup
// Hapus data kadaluarsa: OTP lama, notif_log lama, notifications lama
cronRoute.get('/cleanup', async (c) => {
  const results: Record<string, number | string> = {};

  const [otpRes, notifLogRes, notificationsRes] = await Promise.all([
    supabase.rpc('cleanup_expired_otp'),
    supabase.rpc('cleanup_old_notif_log'),
    supabase.rpc('cleanup_old_notifications'),
  ]);

  results.otp_deleted = otpRes.error ? `error: ${otpRes.error.message}` : (otpRes.data ?? 0);
  results.notif_log_deleted = notifLogRes.error
    ? `error: ${notifLogRes.error.message}`
    : (notifLogRes.data ?? 0);
  results.notifications_deleted = notificationsRes.error
    ? `error: ${notificationsRes.error.message}`
    : (notificationsRes.data ?? 0);

  logger.info('Cron cleanup selesai', results);
  return c.json({ ok: true, ...results });
});
