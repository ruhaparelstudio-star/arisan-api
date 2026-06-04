-- Jalankan di Supabase SQL Editor: https://supabase.com/dashboard/project/vqjfvbvmavwqapsznycp/sql/new

-- Step 1: Aktifkan RLS
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Step 2: Drop FK lama lalu tambah dengan ON DELETE CASCADE
ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_fkey;

ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Step 3: Verifikasi hasilnya
SELECT
  conname AS constraint_name,
  CASE confdeltype
    WHEN 'c' THEN 'CASCADE'
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
  END AS delete_rule,
  c.relrowsecurity AS rls_enabled
FROM pg_constraint pc
JOIN pg_class c ON c.oid = pc.conrelid
WHERE pc.conrelid = 'push_tokens'::regclass
  AND pc.contype = 'f';
