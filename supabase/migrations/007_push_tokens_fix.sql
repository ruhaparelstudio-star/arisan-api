-- 007: push_tokens — tambah ON DELETE CASCADE dan aktifkan RLS
-- Idempotent — aman dijalankan berulang kali.

-- Aktifkan RLS (no policy → hanya service_role yang bisa akses, konsisten dengan tabel lain)
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Tambah ON DELETE CASCADE agar token otomatis terhapus saat user dihapus
ALTER TABLE push_tokens
  DROP CONSTRAINT IF EXISTS push_tokens_user_id_fkey;

ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
