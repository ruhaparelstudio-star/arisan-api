-- P0-5: push_tokens sudah dibuat di 001_initial.sql dengan schema:
--   user_id UUID PRIMARY KEY REFERENCES users(id)
--   expo_push_token TEXT NOT NULL
--   updated_at TIMESTAMPTZ DEFAULT NOW()
-- File ini adalah no-op karena CREATE TABLE IF NOT EXISTS di atas sudah cukup.
-- Perubahan additive (FK CASCADE, RLS) ada di 007_push_tokens_fix.sql
CREATE TABLE IF NOT EXISTS push_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  expo_push_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
