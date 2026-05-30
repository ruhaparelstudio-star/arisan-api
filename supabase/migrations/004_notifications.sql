-- 004_notifications.sql
-- Inbox notifikasi user (terpisah dari notif_log yang merupakan audit trail push)

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  data       JSONB,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread  ON notifications(user_id, is_read) WHERE is_read = FALSE;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- Tidak ada policy → hanya service_role (backend) yang bisa akses.
-- Backend selalu pakai service_role key, jadi tidak butuh policy tambahan.
