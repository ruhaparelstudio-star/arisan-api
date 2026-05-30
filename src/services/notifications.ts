import { Expo } from 'expo-server-sdk';
import { supabase } from '../db/supabase';
import { logger } from '../utils/logger';

const expo = new Expo();

const FONNTE_TOKEN = process.env.FONNTE_TOKEN!;
const FONNTE_TIMEOUT = parseInt(process.env.FONNTE_TIMEOUT_MS ?? '3000');

export async function sendExpoPush(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const { data: tokenRow } = await supabase
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId)
    .single();

  if (!tokenRow) return;

  if (!Expo.isExpoPushToken(tokenRow.expo_push_token)) {
    logger.warn('Invalid Expo push token', { userId });
    return;
  }

  try {
    await expo.sendPushNotificationsAsync([{ to: tokenRow.expo_push_token, title, body, data }]);
  } catch (err) {
    logger.error('Expo push failed', { userId, err });
  }
}

// sendWA(userId) — ambil phone dari DB supaya caller tidak perlu tahu nomor HP
export async function sendWA(userId: string, message: string): Promise<void> {
  try {
    const { data: user } = await supabase.from('users').select('phone').eq('id', userId).single();
    if (!user?.phone) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FONNTE_TIMEOUT);

    try {
      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: { Authorization: FONNTE_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: user.phone, message }),
        signal: controller.signal,
      });
      if (!res.ok) logger.error('Fonnte WA failed', { userId, status: res.status });
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError' ? 'Timeout' : String(err);
      logger.error('Fonnte WA error', { userId, error: msg });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.error('sendWA failed', { userId, error: String(err) });
  }
}

// Tulis notifikasi ke inbox user (tabel notifications)
export async function insertNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .insert({ user_id: userId, type, title, body, data: data ?? null });
  if (error) logger.error('insertNotification failed', { userId, type, error });
}

// Kirim push + WA dengan dedup harian per (user_id, type, sent_date)
export async function sendWithDedup(
  userId: string,
  type: string,
  push: { title: string; body: string },
  waMessage?: string
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('notif_log')
    .insert({ user_id: userId, type, sent_date: today });

  if (error) return; // unique constraint conflict = sudah dikirim hari ini, skip

  await sendExpoPush(userId, push.title, push.body);
  if (waMessage) await sendWA(userId, waMessage);
}
