/**
 * Seed script: simulasi komprehensif grup arisan
 * Jalankan: node seed-simulation.mjs
 *
 * Membuat:
 * - 3 user (1 ketua + 2 anggota)
 * - 1 grup aktif dengan 3 periode
 * - Payments (campuran confirmed + pending)
 * - 1 pemenang undian (periode 1)
 * - Chat messages (user + system)
 * - 1 swap request (pending)
 * - Activity log
 */

import { createClient } from '@supabase/supabase-js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
const envPath = join(__dirname, '.env');
const envLines = readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
}

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket } }
);

const JWT_SECRET = process.env.JWT_SECRET;
const TODAY = new Date('2026-06-01');

function signToken(userId, phone) {
  return jwt.sign({ userId, phone }, JWT_SECRET, { expiresIn: '30d' });
}

function daysAgo(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function daysFromNow(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function daysAgoFull(n, extraMinutes = 0) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  d.setMinutes(d.getMinutes() - extraMinutes);
  return d.toISOString();
}

async function cleanup(phones) {
  console.log('\n[1/9] Cleanup data lama...');

  // Cari user IDs yang mau dihapus
  const { data: existingUsers } = await supabase
    .from('users')
    .select('id')
    .in('phone', phones);

  if (!existingUsers?.length) {
    console.log('  → Tidak ada data lama.');
    return;
  }

  const userIds = existingUsers.map((u) => u.id);

  // Cari group IDs yang dimiliki user ini
  const { data: memberGroups } = await supabase
    .from('group_members')
    .select('group_id')
    .in('user_id', userIds);

  const groupIds = [...new Set((memberGroups ?? []).map((m) => m.group_id))];

  if (groupIds.length) {
    // Cari period IDs
    const { data: periods } = await supabase
      .from('periods')
      .select('id')
      .in('group_id', groupIds);
    const periodIds = (periods ?? []).map((p) => p.id);

    if (periodIds.length) {
      await supabase.from('payments').delete().in('period_id', periodIds);
    }
    await supabase.from('winners').delete().in('group_id', groupIds);
    await supabase.from('messages').delete().in('group_id', groupIds);
    await supabase.from('activity_log').delete().in('group_id', groupIds);
    await supabase.from('swap_requests').delete().in('group_id', groupIds);
    await supabase.from('periods').delete().in('group_id', groupIds);
    await supabase.from('group_members').delete().in('group_id', groupIds);
    await supabase.from('groups').delete().in('id', groupIds);
  }

  await supabase.from('otp_codes').delete().in('phone', phones);
  await supabase.from('otp_rate_limit').delete().in('phone', phones);
  await supabase.from('users').delete().in('id', userIds);

  console.log(`  → Dihapus: ${userIds.length} users, ${groupIds.length} groups`);
}

async function main() {
  console.log('=== SEED SIMULASI ARISAN ===\n');

  const phones = ['+6285600001001', '+6285600001002', '+6285600001003'];
  await cleanup(phones);

  // ── [2/9] USERS ──────────────────────────────────────────────
  console.log('[2/9] Buat users...');
  const { data: users, error: usersErr } = await supabase
    .from('users')
    .insert([
      { phone: '+6285600001001', name: 'Budi Santoso' },
      { phone: '+6285600001002', name: 'Siti Rahayu' },
      { phone: '+6285600001003', name: 'Ahmad Fauzi' },
    ])
    .select();

  if (usersErr) throw new Error('Gagal buat users: ' + usersErr.message);

  const budi = users.find((u) => u.phone === '+6285600001001');
  const siti = users.find((u) => u.phone === '+6285600001002');
  const ahmad = users.find((u) => u.phone === '+6285600001003');

  const tokenBudi = signToken(budi.id, budi.phone);
  const tokenSiti = signToken(siti.id, siti.phone);
  const tokenAhmad = signToken(ahmad.id, ahmad.phone);

  console.log(`  → Budi: ${budi.id}`);
  console.log(`  → Siti: ${siti.id}`);
  console.log(`  → Ahmad: ${ahmad.id}`);

  // ── [3/9] GROUP ───────────────────────────────────────────────
  console.log('[3/9] Buat grup...');
  const inviteCodeExpiry = new Date(TODAY);
  inviteCodeExpiry.setDate(inviteCodeExpiry.getDate() + 7);

  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .insert({
      name: 'Arisan Geng Kantor',
      nominal: 500000,
      frekuensi: 'monthly',
      jumlah_periode: 3,
      mode_undian: 'random',
      ketua_id: budi.id,
      invite_code: 'SIMTEST1',
      invite_code_expires_at: inviteCodeExpiry.toISOString(),
      status: 'active',
    })
    .select()
    .single();

  if (groupErr) throw new Error('Gagal buat group: ' + groupErr.message);
  console.log(`  → Group: ${group.id} (${group.name})`);

  // ── [4/9] MEMBERS ─────────────────────────────────────────────
  console.log('[4/9] Tambah members + set giliran...');
  await supabase.from('group_members').insert([
    { group_id: group.id, user_id: budi.id,  urutan: 1, joined_at: daysAgoFull(30) },
    { group_id: group.id, user_id: siti.id,  urutan: 2, joined_at: daysAgoFull(29) },
    { group_id: group.id, user_id: ahmad.id, urutan: 3, joined_at: daysAgoFull(29) },
  ]);
  console.log('  → 3 anggota bergabung, urutan: Budi(1) Siti(2) Ahmad(3)');

  // ── [5/9] PERIODS ─────────────────────────────────────────────
  console.log('[5/9] Buat 3 periode...');
  const { data: periods, error: periodErr } = await supabase
    .from('periods')
    .insert([
      {
        group_id: group.id,
        periode_ke: 1,
        status: 'closed',
        tanggal_pelaksanaan: daysAgo(28),
        jatuh_tempo: daysAgo(30),
      },
      {
        group_id: group.id,
        periode_ke: 2,
        status: 'active',
        tanggal_pelaksanaan: null,
        jatuh_tempo: daysFromNow(3),
      },
      {
        group_id: group.id,
        periode_ke: 3,
        status: 'upcoming',
        tanggal_pelaksanaan: null,
        jatuh_tempo: daysFromNow(33),
      },
    ])
    .select();

  if (periodErr) throw new Error('Gagal buat periods: ' + periodErr.message);

  const p1 = periods.find((p) => p.periode_ke === 1);
  const p2 = periods.find((p) => p.periode_ke === 2);
  console.log(`  → P1(closed): ${p1.id}`);
  console.log(`  → P2(active): ${p2.id} — jatuh tempo ${daysFromNow(3)}`);
  console.log(`  → P3(upcoming): ${periods.find((p) => p.periode_ke === 3).id}`);

  // ── [6/9] PAYMENTS ────────────────────────────────────────────
  console.log('[6/9] Buat payments...');

  // Periode 1 — semua confirmed (closed period)
  const confAt1 = daysAgoFull(27);
  await supabase.from('payments').insert([
    { period_id: p1.id, user_id: budi.id,  status: 'confirmed', confirmed_by: budi.id, confirmed_at: confAt1 },
    { period_id: p1.id, user_id: siti.id,  status: 'confirmed', confirmed_by: budi.id, confirmed_at: daysAgoFull(27, 5) },
    { period_id: p1.id, user_id: ahmad.id, status: 'confirmed', confirmed_by: budi.id, confirmed_at: daysAgoFull(27, 10) },
  ]);

  // Periode 2 — Budi + Siti confirmed, Ahmad pending
  const confAt2 = daysAgoFull(2);
  await supabase.from('payments').insert([
    { period_id: p2.id, user_id: budi.id, status: 'confirmed', confirmed_by: budi.id, confirmed_at: confAt2 },
    { period_id: p2.id, user_id: siti.id, status: 'confirmed', confirmed_by: budi.id, confirmed_at: daysAgoFull(2, 10) },
  ]);

  console.log('  → P1: Budi✓ Siti✓ Ahmad✓');
  console.log('  → P2: Budi✓ Siti✓ Ahmad⏰(pending)');

  // ── [7/9] WINNERS ─────────────────────────────────────────────
  console.log('[7/9] Buat undian winner periode 1...');
  await supabase.from('winners').insert({
    group_id: group.id,
    period_id: p1.id,
    user_id: siti.id,
    created_at: daysAgoFull(28, 0),
  });
  console.log('  → Pemenang P1: Siti Rahayu');

  // ── [8/9] MESSAGES ────────────────────────────────────────────
  console.log('[8/9] Buat chat messages...');
  const msgs = [
    { group_id: group.id, user_id: budi.id,  content: 'Halo geng! Arisan Geng Kantor resmi mulai ya 🎉', created_at: daysAgoFull(29, 60) },
    { group_id: group.id, user_id: siti.id,  content: 'Yeayy siap kak Budi! Semangat arisan', created_at: daysAgoFull(29, 55) },
    { group_id: group.id, user_id: ahmad.id, content: 'Mantap bos! Siap ikutan 💪', created_at: daysAgoFull(29, 50) },
    { group_id: group.id, user_id: null,     content: 'Undian periode 1 selesai. Pemenang: Siti Rahayu 🎉', created_at: daysAgoFull(28, 0) },
    { group_id: group.id, user_id: siti.id,  content: 'Makasih semua! Arisan bulan ini buat modal usaha dulu hehe 😊', created_at: daysAgoFull(27, 120) },
    { group_id: group.id, user_id: budi.id,  content: 'Periode 2 udah mulai nih. Ingat jatuh tempo tanggal 4 Juni ya!', created_at: daysAgoFull(3, 0) },
    { group_id: group.id, user_id: ahmad.id, content: 'Kak Budi, boleh minta tukar giliran sama kak Siti ga? Biar aku ambil periode 2 kak', created_at: daysAgoFull(2, 120) },
    { group_id: group.id, user_id: budi.id,  content: 'Request aja langsung dari app ya Fauzi 👍', created_at: daysAgoFull(2, 115) },
    { group_id: group.id, user_id: null,     content: 'Budi Santoso mengkonfirmasi pembayaran Budi Santoso ✓', created_at: daysAgoFull(2, 0) },
    { group_id: group.id, user_id: null,     content: 'Budi Santoso mengkonfirmasi pembayaran Siti Rahayu ✓', created_at: daysAgoFull(2, 5) },
    { group_id: group.id, user_id: siti.id,  content: 'Makasih kak sudah dikonfirm! 🙏', created_at: daysAgoFull(2, 10) },
    { group_id: group.id, user_id: ahmad.id, content: 'Maaf kak belum bisa bayar, besok ya 🙏', created_at: daysAgoFull(1, 60) },
    { group_id: group.id, user_id: budi.id,  content: 'Oke Fauzi, jangan sampai lewat jatuh tempo ya 😊', created_at: daysAgoFull(1, 55) },
  ];

  await supabase.from('messages').insert(msgs);
  console.log(`  → ${msgs.length} pesan terkirim`);

  // ── SWAP REQUEST ──────────────────────────────────────────────
  console.log('[8b/9] Buat swap request Ahmad→Siti (pending)...');
  await supabase.from('swap_requests').insert({
    group_id: group.id,
    requester_id: ahmad.id,
    target_id: siti.id,
    status: 'pending',
    created_at: daysAgoFull(2, 110),
  });
  console.log('  → Ahmad (periode 3) request swap ke Siti (periode 2) — status: pending');

  // ── [9/9] ACTIVITY LOG ────────────────────────────────────────
  console.log('[9/9] Buat activity log...');
  await supabase.from('activity_log').insert([
    { group_id: group.id, actor_id: budi.id,  action: 'group_created',    description: 'Grup "Arisan Geng Kantor" dibuat',           created_at: daysAgoFull(30) },
    { group_id: group.id, actor_id: siti.id,  action: 'member_joined',    description: 'Siti Rahayu bergabung ke grup',              created_at: daysAgoFull(29, 55) },
    { group_id: group.id, actor_id: ahmad.id, action: 'member_joined',    description: 'Ahmad Fauzi bergabung ke grup',              created_at: daysAgoFull(29, 50) },
    { group_id: group.id, actor_id: budi.id,  action: 'urutan_updated',   description: 'Urutan giliran diperbarui oleh ketua',       created_at: daysAgoFull(29, 40) },
    { group_id: group.id, actor_id: budi.id,  action: 'undian_done',      description: 'Undian periode 1 selesai. Pemenang: Siti Rahayu', created_at: daysAgoFull(28) },
    { group_id: group.id, actor_id: budi.id,  action: 'payment_confirmed', description: 'Budi Santoso mengkonfirmasi pembayaran Budi Santoso', created_at: daysAgoFull(2) },
    { group_id: group.id, actor_id: budi.id,  action: 'payment_confirmed', description: 'Budi Santoso mengkonfirmasi pembayaran Siti Rahayu', created_at: daysAgoFull(2, 5) },
    { group_id: group.id, actor_id: ahmad.id, action: 'swap_requested',   description: 'Ahmad Fauzi mengajukan tukar giliran dengan Siti Rahayu', created_at: daysAgoFull(2, 110) },
  ]);
  console.log('  → 8 entri activity log');

  // ══════════════════════════════════════════════════════════════
  console.log('\n=== SEED SELESAI ✅ ===\n');
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│              CREDENTIALS UNTUK DEVICE TEST              │');
  console.log('├────────────────┬────────────────────────────────────────┤');
  console.log('│ Role           │ Phone / Token                          │');
  console.log('├────────────────┼────────────────────────────────────────┤');
  console.log(`│ Ketua (Budi)   │ Phone: +6285600001001                  │`);
  console.log(`│                │ Token: ${tokenBudi.slice(0, 40)}...│`);
  console.log('├────────────────┼────────────────────────────────────────┤');
  console.log(`│ Anggota (Siti) │ Phone: +6285600001002                  │`);
  console.log(`│                │ Token: ${tokenSiti.slice(0, 40)}...│`);
  console.log('├────────────────┼────────────────────────────────────────┤');
  console.log(`│ Anggota(Ahmad) │ Phone: +6285600001003                  │`);
  console.log(`│                │ Token: ${tokenAhmad.slice(0, 40)}...│`);
  console.log('└────────────────┴────────────────────────────────────────┘\n');
  console.log('GROUP INFO:');
  console.log(`  ID   : ${group.id}`);
  console.log(`  Nama : ${group.name}`);
  console.log(`  Kode : SIMTEST1`);
  console.log(`  P2 ID: ${p2.id} (active, jatuh tempo ${daysFromNow(3)})`);
  console.log('\nDEVICE TEST STEPS:');
  console.log('  1. adb reverse tcp:3001 tcp:3001');
  console.log('  2. Login sebagai Budi (+6285600001001) — masukkan token di SecureStore');
  console.log('     ATAU gunakan endpoint bypass di bawah untuk inject token langsung\n');
  console.log('INJECT TOKEN VIA ADB (simpan ke app):');
  console.log(`  Token Budi (full):\n  ${tokenBudi}\n`);

  // Simpan token ke file untuk mudah dipakai
  const outPath = join(__dirname, 'seed-output.json');
  const { writeFileSync } = await import('fs');
  writeFileSync(outPath, JSON.stringify({
    users: { budi: { id: budi.id, phone: budi.phone, token: tokenBudi },
              siti: { id: siti.id, phone: siti.phone, token: tokenSiti },
              ahmad: { id: ahmad.id, phone: ahmad.phone, token: tokenAhmad } },
    group: { id: group.id, name: group.name, invite_code: 'SIMTEST1' },
    periods: { p1: p1.id, p2: p2.id },
  }, null, 2));

  console.log(`Output lengkap tersimpan di: seed-output.json`);
}

main().catch((err) => {
  console.error('\n❌ Seed gagal:', err.message);
  process.exit(1);
});
