-- P0-1: Fungsi undian_random untuk mode undian acak
-- Memilih anggota yang belum pernah menang di grup ini secara acak menggunakan PostgreSQL RANDOM()
CREATE OR REPLACE FUNCTION undian_random(p_group_id UUID) RETURNS UUID AS $$
  SELECT gm.user_id FROM group_members gm
  WHERE gm.group_id = p_group_id
  AND gm.user_id NOT IN (
    SELECT w.user_id FROM winners w WHERE w.group_id = p_group_id
  )
  ORDER BY RANDOM() LIMIT 1;
$$ LANGUAGE SQL;
