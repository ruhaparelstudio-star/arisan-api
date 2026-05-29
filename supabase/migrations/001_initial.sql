-- =====================
-- USERS
-- =====================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- =====================
-- OTP
-- =====================
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS otp_rate_limit (
  phone VARCHAR(20) PRIMARY KEY,
  attempt_count INT DEFAULT 0,
  window_start TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- GROUPS
-- =====================
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  ketua_id UUID REFERENCES users(id),
  nominal BIGINT NOT NULL,
  frekuensi VARCHAR(20) NOT NULL,
  jumlah_periode INT NOT NULL,
  mode_undian VARCHAR(20) NOT NULL,
  invite_code VARCHAR(10) UNIQUE,
  invite_code_expires_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'recruiting',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  user_id UUID REFERENCES users(id),
  urutan INT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

-- =====================
-- PERIODS & PAYMENTS
-- =====================
CREATE TABLE IF NOT EXISTS periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  periode_ke INT NOT NULL,
  tanggal_pelaksanaan DATE,
  jatuh_tempo DATE,
  status VARCHAR(20) DEFAULT 'upcoming',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES periods(id),
  user_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_id, user_id)
);

-- =====================
-- WINNERS (APPEND-ONLY)
-- =====================
CREATE TABLE IF NOT EXISTS winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  period_id UUID REFERENCES periods(id),
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- SWAPS
-- =====================
CREATE TABLE IF NOT EXISTS swap_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  requester_id UUID REFERENCES users(id),
  target_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'pending',
  target_response_at TIMESTAMPTZ,
  ketua_response_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- ACTIVITY LOG (APPEND-ONLY)
-- =====================
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id),
  actor_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- NOTIFICATIONS
-- =====================
CREATE TABLE IF NOT EXISTS notif_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  sent_date DATE NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, type, sent_date)
);

CREATE TABLE IF NOT EXISTS push_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  expo_push_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================
-- RLS
-- =====================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_requests ENABLE ROW LEVEL SECURITY;

-- =====================
-- REALTIME
-- =====================
ALTER PUBLICATION supabase_realtime ADD TABLE payments;
ALTER PUBLICATION supabase_realtime ADD TABLE winners;
ALTER PUBLICATION supabase_realtime ADD TABLE swap_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE periods;

-- =====================
-- CEK pg_cron
-- =====================
SELECT * FROM pg_available_extensions WHERE name = 'pg_cron';
-- Catat hasilnya di PROGRESS.md section "pg_cron status"
