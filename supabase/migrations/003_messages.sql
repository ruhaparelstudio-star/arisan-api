-- 003_messages.sql
-- Tabel chat messages untuk grup arisan (Supabase Realtime, Opsi B)
--
-- RLS sengaja tidak diaktifkan karena backend pakai service_role (bypass RLS).
-- Keamanan insert dijamin oleh backend (validasi membership sebelum insert).
-- Keamanan baca di mobile bergantung pada group_id UUID (hard to guess).
-- TODO: aktifkan RLS proper setelah migrasi ke Supabase Auth.

CREATE TABLE IF NOT EXISTS messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  content     TEXT NOT NULL CHECK (char_length(content) <= 500),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages(group_id, created_at DESC);

-- Enable Supabase Realtime untuk tabel ini
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
