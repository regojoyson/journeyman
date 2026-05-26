-- 030_webhook_wait_correlation.sql
-- Add per-wait correlation fields. Resolved at pause time from
-- webhook-wait.config.correlationKey.value, matched at event-arrival time.

ALTER TABLE jm_node_executions
  ADD COLUMN IF NOT EXISTS correlation_event_path TEXT,
  ADD COLUMN IF NOT EXISTS correlation_value      TEXT;

CREATE INDEX IF NOT EXISTS jm_node_executions_correlation_value_idx
  ON jm_node_executions (correlation_value)
  WHERE status = 'waiting';
