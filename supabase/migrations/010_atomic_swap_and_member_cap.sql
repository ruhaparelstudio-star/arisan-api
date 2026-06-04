-- =====================================================================
-- 010_atomic_swap_and_member_cap.sql
--
-- (1) swap_group_member_urutan — atomic urutan exchange in one transaction
--     Fixes GAP-01: two separate UPDATEs were not atomic; concurrent reads
--     between them could see inconsistent state.
--
-- (2) check_group_member_cap — enforce max members = groups.jumlah_periode
--     Fixes GAP-03: app-level count→insert was a race condition. Two
--     concurrent joins could both pass the app check and both succeed,
--     giving the group more members than jumlah_periode.
-- =====================================================================

-- (1) Atomic urutan swap
CREATE OR REPLACE FUNCTION swap_group_member_urutan(
  p_group_id   UUID,
  p_user_a_id  UUID,
  p_user_b_id  UUID
) RETURNS VOID AS $$
DECLARE
  urutan_a INT;
  urutan_b INT;
BEGIN
  SELECT urutan INTO urutan_a FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_a_id FOR UPDATE;
  SELECT urutan INTO urutan_b FROM group_members
    WHERE group_id = p_group_id AND user_id = p_user_b_id FOR UPDATE;

  IF urutan_a IS NULL OR urutan_b IS NULL THEN
    RAISE EXCEPTION 'Salah satu anggota tidak ditemukan di grup'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE group_members SET urutan = urutan_b
    WHERE group_id = p_group_id AND user_id = p_user_a_id;
  UPDATE group_members SET urutan = urutan_a
    WHERE group_id = p_group_id AND user_id = p_user_b_id;
END;
$$ LANGUAGE plpgsql;

-- (2) Trigger: enforce jumlah_periode as the hard cap on member count
CREATE OR REPLACE FUNCTION check_group_member_cap()
RETURNS TRIGGER AS $$
DECLARE
  current_count INT;
  max_members   INT;
BEGIN
  SELECT COUNT(*) INTO current_count
    FROM group_members WHERE group_id = NEW.group_id;

  SELECT jumlah_periode INTO max_members
    FROM groups WHERE id = NEW.group_id;

  -- current_count is BEFORE this insert (trigger fires BEFORE INSERT)
  IF current_count >= max_members THEN
    RAISE EXCEPTION 'Grup sudah penuh (maksimal % anggota)', max_members
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_group_member_cap ON group_members;

CREATE TRIGGER trg_check_group_member_cap
  BEFORE INSERT ON group_members
  FOR EACH ROW
  EXECUTE FUNCTION check_group_member_cap();
