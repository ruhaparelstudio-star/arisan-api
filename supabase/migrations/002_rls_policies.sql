-- =====================================================================
-- 002_rls_policies.sql
-- RLS Policy Setup — Arisan App
-- Hanya berisi DDL idempoten (Section B).
-- Audit/test queries dipindah ke docs/rls_audit.sql (tidak dijalankan otomatis).
-- =====================================================================

-- B1. Aktifkan RLS pada tabel yang mungkin belum diset di 001
ALTER TABLE IF EXISTS otp_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS otp_rate_limit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS otp_delivery_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS periods            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notif_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS push_tokens        ENABLE ROW LEVEL SECURITY;

-- B1b. DISABLE RLS pada messages (intentional MVP)
-- Mobile pakai anon key untuk Supabase Realtime; custom JWT tidak punya sub claim
-- sehingga auth.uid() = null dan RLS policy tidak bisa diterapkan.
ALTER TABLE IF EXISTS messages DISABLE ROW LEVEL SECURITY;

-- B2. Force RLS even for table owners
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

-- B3. Revoke akses tabel OTP dari anon dan authenticated role
REVOKE ALL ON otp_codes        FROM anon, authenticated;
REVOKE ALL ON otp_rate_limit   FROM anon, authenticated;
REVOKE ALL ON otp_delivery_log FROM anon, authenticated;

-- B4. Hapus policy lama pada winners & activity_log jika ada
DROP POLICY IF EXISTS winners_insert_only ON winners;
DROP POLICY IF EXISTS activity_log_insert_only ON activity_log;
