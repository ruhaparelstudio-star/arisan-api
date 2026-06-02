-- =====================================================================
-- 002_rls_policies.sql
-- RLS Audit & Policy Setup — Arisan App
--
-- Konteks:
--   Backend Node.js pakai service_role key → bypass RLS sepenuhnya.
--   RLS adalah lapisan defense-in-depth: jika anon/authenticated key
--   bocor, data tetap terlindungi.
--
-- Cara pakai:
--   Jalankan section per section di Supabase SQL Editor.
--   Section A = audit (read-only, aman dijalankan kapan saja).
--   Section B = fix/policy (jalankan sekali, idempoten dengan IF NOT EXISTS).
--
-- Tabel & status RLS yang diharapkan:
--   users            → RLS ON, no policy (deny all non-service-role)
--   groups           → RLS ON, no policy
--   group_members    → RLS ON, no policy
--   payments         → RLS ON, no policy
--   winners          → RLS ON, no policy (INSERT ONLY via backend)
--   activity_log     → RLS ON, no policy (INSERT ONLY via backend)
--   swap_requests    → RLS ON, no policy
--   periods          → RLS ON, no policy
--   push_tokens      → RLS ON, no policy
--   notif_log        → RLS ON, no policy
--   notifications    → RLS ON, no policy (diset di 004_notifications.sql)
--   otp_codes        → RLS ON + REVOKE (sensitif, no policy)
--   otp_rate_limit   → RLS ON + REVOKE
--   otp_delivery_log → RLS ON + REVOKE
--   messages         → RLS OFF (sengaja, lihat catatan di bawah)
--
-- Catatan messages:
--   RLS sengaja OFF karena JWT kustom tidak punya sub claim sehingga
--   auth.uid() tidak berfungsi. Security dijamin via:
--   (1) backend membership check sebelum INSERT,
--   (2) group_id UUID (128-bit, not guessable),
--   (3) Realtime filter group_id=eq.<uuid>.
--   TODO: aktifkan RLS setelah migrasi ke Supabase Auth.
-- =====================================================================


-- =====================================================================
-- SECTION A — AUDIT (READ-ONLY)
-- Aman dijalankan kapan saja, tidak mengubah data.
-- =====================================================================

-- A1. Status RLS semua tabel public
SELECT
  tablename,
  rowsecurity AS rls_enabled,
  CASE WHEN rowsecurity THEN 'AMAN' ELSE 'EXPOSED' END AS status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rls_enabled DESC, tablename;

-- =====================================================================

-- A2. Semua policy yang ada saat ini
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd           AS operation,
  qual          AS using_expr,
  with_check    AS with_check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- =====================================================================

-- A3. Verdict per tabel
SELECT
  t.tablename,
  t.rowsecurity AS rls_enabled,
  COUNT(p.policyname) AS policy_count,
  CASE
    WHEN t.tablename = 'messages' AND NOT t.rowsecurity
      THEN '⚠ EXPOSED (intentional MVP — aktifkan RLS sebelum production)'
    WHEN t.rowsecurity AND COUNT(p.policyname) = 0
      THEN '✅ BLOCKED — no policy (ok, hanya service_role yang bisa akses)'
    WHEN t.rowsecurity AND COUNT(p.policyname) > 0
      THEN '✅ PROTECTED — ada policy'
    ELSE '❌ EXPOSED — RLS off'
  END AS verdict
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname AND p.tablename = t.tablename
WHERE t.schemaname = 'public'
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.rowsecurity DESC, t.tablename;

-- =====================================================================

-- A4. Verifikasi winners = INSERT ONLY (tidak boleh ada policy UPDATE/DELETE)
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'winners'
  AND cmd IN ('UPDATE', 'DELETE');
-- Hasil yang benar: 0 rows

-- =====================================================================

-- A5. Verifikasi activity_log = INSERT ONLY
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'activity_log'
  AND cmd IN ('UPDATE', 'DELETE');
-- Hasil yang benar: 0 rows

-- =====================================================================

-- A6. Tabel yang belum punya RLS (selain messages yang sengaja)
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
  AND tablename != 'messages'   -- intentionally exposed
ORDER BY tablename;
-- Hasil yang benar: 0 rows


-- =====================================================================
-- SECTION B — ENABLE RLS & HARDENING
-- Jalankan setelah audit Section A selesai.
-- Semua statement idempoten (aman dijalankan ulang).
-- =====================================================================

-- B1. Aktifkan RLS pada tabel yang mungkin belum diset
--     (001_initial.sql sudah set sebagian, ini safety net)
ALTER TABLE IF EXISTS otp_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS otp_rate_limit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS otp_delivery_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS periods            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notif_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS push_tokens        ENABLE ROW LEVEL SECURITY;
-- notifications sudah di-enable di 004_notifications.sql

-- B1b. DISABLE RLS pada messages (intentional — lihat catatan di header)
--      Mobile pakai anon key untuk Supabase direct queries; custom JWT
--      userId tidak bisa dibaca oleh RLS policy (auth.uid() = null).
--      Jika RLS ON tanpa policy → fetchMessages() + Realtime keduanya
--      mengembalikan data kosong → chat mati.
ALTER TABLE IF EXISTS messages DISABLE ROW LEVEL SECURITY;

-- =====================================================================

-- B2. Force RLS even for table owners
--     Karena service_role bypass RLS by default, ini TIDAK mempengaruhi
--     backend — hanya mencegah akses via psql direct oleh table owner.
ALTER TABLE users             FORCE ROW LEVEL SECURITY;
ALTER TABLE groups            FORCE ROW LEVEL SECURITY;
ALTER TABLE group_members     FORCE ROW LEVEL SECURITY;
ALTER TABLE payments          FORCE ROW LEVEL SECURITY;
ALTER TABLE winners           FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_log      FORCE ROW LEVEL SECURITY;
ALTER TABLE swap_requests     FORCE ROW LEVEL SECURITY;
ALTER TABLE periods           FORCE ROW LEVEL SECURITY;
ALTER TABLE push_tokens       FORCE ROW LEVEL SECURITY;
ALTER TABLE notif_log         FORCE ROW LEVEL SECURITY;
ALTER TABLE otp_codes         FORCE ROW LEVEL SECURITY;
ALTER TABLE otp_rate_limit    FORCE ROW LEVEL SECURITY;
ALTER TABLE otp_delivery_log  FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications     FORCE ROW LEVEL SECURITY;
-- messages: skip FORCE karena RLS-nya OFF

-- =====================================================================

-- B3. Revoke akses tabel OTP dari anon dan authenticated role
--     Tabel ini tidak boleh diakses sama sekali dari client.
REVOKE ALL ON otp_codes          FROM anon, authenticated;
REVOKE ALL ON otp_rate_limit     FROM anon, authenticated;
REVOKE ALL ON otp_delivery_log   FROM anon, authenticated;

-- =====================================================================

-- B4. winners & activity_log — sudah RLS ON tanpa policy = deny all
--     Hapus policy lama jika ada (idempoten)
DROP POLICY IF EXISTS winners_insert_only ON winners;
DROP POLICY IF EXISTS activity_log_insert_only ON activity_log;
-- Tidak buat policy apapun → block by default untuk non-service-role.

-- =====================================================================

-- B5. Verifikasi tidak ada policy UPDATE/DELETE berbahaya
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('winners', 'activity_log')
  AND cmd IN ('UPDATE', 'DELETE');
-- Hasil yang benar: 0 rows


-- =====================================================================
-- SECTION C — FUNCTIONAL TEST
-- Simulasikan akses sebagai 'authenticated' role (bukan service_role).
-- Jalankan dalam satu transaction agar RESET ROLE berfungsi.
-- =====================================================================

BEGIN;

-- C1. Set local role ke authenticated untuk simulasi client
SET LOCAL ROLE authenticated;

-- C2. Test baca winners → harus 0 rows (no SELECT policy)
SELECT count(*) AS winners_visible FROM winners;
-- Expected: 0

-- C3. Test baca activity_log → harus 0 rows
SELECT count(*) AS logs_visible FROM activity_log;
-- Expected: 0

-- C4. Test baca notifications → harus 0 rows
SELECT count(*) AS notif_visible FROM notifications;
-- Expected: 0

-- C5. Test baca messages → AKAN BERHASIL (RLS OFF, intentional)
SELECT count(*) AS messages_visible FROM messages;
-- Expected: jumlah pesan yang ada (ini memang by design untuk MVP)

-- C6. Test UPDATE winners → harus error RLS
UPDATE winners SET user_id = gen_random_uuid() WHERE false;
-- Expected: ERROR atau 0 rows affected

-- C7. Test DELETE dari activity_log → harus ditolak
DELETE FROM activity_log WHERE false;
-- Expected: ERROR atau 0 rows affected

-- C8. Test akses otp_codes → harus ditolak (permission denied)
SELECT count(*) FROM otp_codes;
-- Expected: ERROR permission denied

ROLLBACK;
-- ROLLBACK agar tidak ada perubahan dari test, dan RESET ROLE otomatis


-- =====================================================================
-- SECTION D — SUMMARY AKHIR
-- Jalankan setelah Section B untuk konfirmasi semua sudah benar.
-- =====================================================================

SELECT
  t.tablename,
  t.rowsecurity                     AS rls_enabled,
  COUNT(p.policyname)               AS policy_count,
  CASE
    WHEN t.tablename = 'messages' AND NOT t.rowsecurity
      THEN '⚠  EXPOSED — intentional MVP (aktifkan sebelum production)'
    WHEN NOT t.rowsecurity
      THEN '❌ EXPOSED — harus difix!'
    WHEN t.rowsecurity AND COUNT(p.policyname) = 0
      THEN '✅ BLOCKED (no policy = deny all non-service-role)'
    ELSE '✅ POLICY SET'
  END AS verdict
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname AND p.tablename = t.tablename
WHERE t.schemaname = 'public'
GROUP BY t.tablename, t.rowsecurity
ORDER BY
  CASE
    WHEN NOT t.rowsecurity AND t.tablename != 'messages' THEN 0
    WHEN t.tablename = 'messages' THEN 1
    ELSE 2
  END,
  t.tablename;
