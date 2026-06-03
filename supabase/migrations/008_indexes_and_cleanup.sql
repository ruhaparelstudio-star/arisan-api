-- =====================================================================
-- 008_indexes_and_cleanup.sql
-- DB Indexes untuk performa + OTP cleanup function
-- =====================================================================

-- =====================
-- INDEXES — FK columns yang sering di-query
-- =====================

-- group_members: query utama = group_id + user_id
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id  ON group_members(user_id);

-- periods: query utama = group_id + status
CREATE INDEX IF NOT EXISTS idx_periods_group_id        ON periods(group_id);
CREATE INDEX IF NOT EXISTS idx_periods_group_status    ON periods(group_id, status);
CREATE INDEX IF NOT EXISTS idx_periods_jatuh_tempo     ON periods(jatuh_tempo) WHERE jatuh_tempo IS NOT NULL;

-- payments: query utama = period_id + user_id + status
CREATE INDEX IF NOT EXISTS idx_payments_period_id      ON payments(period_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id        ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_period_status  ON payments(period_id, status);

-- winners: query utama = group_id + period_id + user_id
CREATE INDEX IF NOT EXISTS idx_winners_group_id        ON winners(group_id);
CREATE INDEX IF NOT EXISTS idx_winners_group_user      ON winners(group_id, user_id);
CREATE INDEX IF NOT EXISTS idx_winners_period_id       ON winners(period_id);

-- swap_requests: query utama = group_id + status + requester/target
CREATE INDEX IF NOT EXISTS idx_swaps_group_id          ON swap_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_swaps_requester_id      ON swap_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_swaps_target_id         ON swap_requests(target_id);
CREATE INDEX IF NOT EXISTS idx_swaps_group_status      ON swap_requests(group_id, status);

-- activity_log: query utama = group_id + created_at (desc)
CREATE INDEX IF NOT EXISTS idx_activity_group_id       ON activity_log(group_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at     ON activity_log(group_id, created_at DESC);

-- notifications: query utama = user_id + is_read + created_at
CREATE INDEX IF NOT EXISTS idx_notif_user_id           ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread       ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notif_created_at        ON notifications(user_id, created_at DESC);

-- messages: query utama = group_id + created_at
CREATE INDEX IF NOT EXISTS idx_messages_group_id       ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_messages_group_created  ON messages(group_id, created_at DESC);

-- otp_codes: query utama = phone + used_at + expires_at
CREATE INDEX IF NOT EXISTS idx_otp_phone               ON otp_codes(phone);
CREATE INDEX IF NOT EXISTS idx_otp_phone_active        ON otp_codes(phone, expires_at) WHERE used_at IS NULL;

-- notif_log: sudah ada UNIQUE(user_id, type, sent_date), index otomatis

-- =====================
-- OTP CLEANUP — hapus kode lama otomatis
-- Jalankan via pg_cron atau manual bulanan
-- =====================

-- Fungsi cleanup OTP kadaluarsa (> 24 jam)
CREATE OR REPLACE FUNCTION cleanup_expired_otp()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM otp_codes
  WHERE (used_at IS NOT NULL OR expires_at < NOW() - INTERVAL '24 hours');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Fungsi cleanup notif_log lama (> 90 hari)
CREATE OR REPLACE FUNCTION cleanup_old_notif_log()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM notif_log WHERE sent_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
