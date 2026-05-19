-- 006_run_attempt_number.sql
-- Persist the flow-wide retry attempt counter on each run so it survives
-- orchestrator process restarts.
ALTER TABLE jm_runs
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;
