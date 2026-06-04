-- =====================================================================
-- 011_cleanup_notifications.sql
-- Cleanup function for the notifications inbox table.
-- Fixes GAP-13: notifications table had no cleanup, could grow indefinitely.
-- =====================================================================

CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Keep last 90 days; read notifications older than 30 days can be removed sooner
  DELETE FROM notifications
  WHERE created_at < NOW() - INTERVAL '90 days'
     OR (is_read = true AND created_at < NOW() - INTERVAL '30 days');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
