-- =====================================================================
-- 009_group_member_limit.sql
-- DB-level enforcement: max 3 grup aktif/recruiting per user
-- Fix GAP-13: canUserJoinOrCreate race condition — app-level check
-- bisa di-bypass oleh concurrent requests; trigger ini atomic.
-- =====================================================================

CREATE OR REPLACE FUNCTION check_user_group_limit()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO active_count
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id
   WHERE gm.user_id = NEW.user_id
     AND g.status IN ('recruiting', 'active');

  IF active_count >= 3 THEN
    RAISE EXCEPTION 'User sudah bergabung di 3 grup aktif (max). Selesaikan atau keluar dari grup yang ada dulu.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop dulu jika sudah ada (idempoten)
DROP TRIGGER IF EXISTS trg_check_user_group_limit ON group_members;

CREATE TRIGGER trg_check_user_group_limit
  BEFORE INSERT ON group_members
  FOR EACH ROW
  EXECUTE FUNCTION check_user_group_limit();

-- Unique constraint: satu user hanya bisa ada sekali per grup
-- (mencegah double-insert race condition juga)
ALTER TABLE group_members
  DROP CONSTRAINT IF EXISTS uq_group_members_group_user;

ALTER TABLE group_members
  ADD CONSTRAINT uq_group_members_group_user
  UNIQUE (group_id, user_id);

-- Unique constraint: satu winner per periode per grup
-- (fix GAP-02 jika belum ada di DB)
ALTER TABLE winners
  DROP CONSTRAINT IF EXISTS uq_winners_period_group;

ALTER TABLE winners
  ADD CONSTRAINT uq_winners_period_group
  UNIQUE (period_id, group_id);
