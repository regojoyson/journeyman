-- 031_drop_webhook_events_issue_ref.sql
-- The webhook-wait matcher now routes via per-wait correlation values stored on
-- jm_node_executions. The legacy per-event issue_ref column is no longer
-- populated or queried, so drop it (and its index).

DROP INDEX IF EXISTS jm_webhook_events_issue_ref_idx;

ALTER TABLE jm_webhook_events
  DROP COLUMN IF EXISTS issue_ref;
