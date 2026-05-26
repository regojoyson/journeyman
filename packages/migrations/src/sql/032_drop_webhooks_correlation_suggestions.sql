-- 032_drop_webhooks_correlation_suggestions.sql
-- The per-preset correlation_suggestions table was only used to auto-populate
-- the now-removed jm_webhook_events.issue_ref. With no consumers left, drop
-- the column.

ALTER TABLE jm_webhooks
  DROP COLUMN IF EXISTS correlation_suggestions;
