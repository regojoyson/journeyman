-- 029: add resolved_by audit column to jm_human_task_resolutions.
-- Distinguishes how a paused webhook-wait/human-task was resolved beyond
-- the high-level `source` column (e.g. node-level timeout vs. operator-level
-- max-age sweep).

ALTER TABLE jm_human_task_resolutions
  ADD COLUMN IF NOT EXISTS resolved_by TEXT;

CREATE INDEX IF NOT EXISTS jm_human_task_resolutions_resolved_by_idx
  ON jm_human_task_resolutions (resolved_by)
  WHERE resolved_by IS NOT NULL;
