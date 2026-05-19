-- 016_human_tasks.sql
-- Adds the conductor_task_id column for HUMAN tasks and the human-task
-- resolutions audit table. The status column on jm_node_executions is plain
-- TEXT (no CHECK constraint), so the new "waiting" value needs no schema change.

BEGIN;

-- Conductor's task id for an externally-completed HUMAN task. Populated by the
-- engine reconciler when it observes an IN_PROGRESS HUMAN task; consumed by
-- resolveHumanTask when calling Conductor's completeTask endpoint.
ALTER TABLE jm_node_executions
  ADD COLUMN IF NOT EXISTS conductor_task_id TEXT NULL;

CREATE TABLE IF NOT EXISTS jm_human_task_resolutions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  node_id             TEXT NOT NULL,
  outcome             TEXT NOT NULL,
  comment             TEXT NULL,
  actor               TEXT NULL,
  source              TEXT NOT NULL CHECK (source IN ('webhook','manual','timeout')),
  webhook_event_id    UUID NULL REFERENCES jm_webhook_events(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jm_human_task_resolutions_run_node_idx
  ON jm_human_task_resolutions(run_id, node_id);

CREATE INDEX IF NOT EXISTS jm_node_executions_waiting_idx
  ON jm_node_executions(run_id) WHERE status = 'waiting';

COMMIT;
