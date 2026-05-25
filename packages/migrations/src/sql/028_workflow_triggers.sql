-- 028_workflow_triggers.sql
-- Adds the workflow trigger index (used by webhook ingest to find which
-- workflows to start) and extends jm_workflow_instances with per-instance
-- trigger metadata (trigger node id + form submission id). Also creates
-- the form-submission audit table.

CREATE TABLE jm_workflow_triggers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id         UUID NOT NULL,
  workflow_version_id UUID NOT NULL,
  trigger_node_id     TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('manual','webhook','human')),
  webhook_id          UUID NULL,
  is_active           BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_version_id, trigger_node_id)
);

CREATE INDEX idx_jm_workflow_triggers_webhook_active
  ON jm_workflow_triggers (webhook_id)
  WHERE is_active = true AND kind = 'webhook';

CREATE INDEX idx_jm_workflow_triggers_workflow
  ON jm_workflow_triggers (workflow_id);

-- Per-instance trigger metadata. trigger_source is already TEXT NOT NULL on
-- jm_workflow_instances (see 001_initial.sql) so no enum change is needed —
-- the 'human' value is enforced at the application layer.
ALTER TABLE jm_workflow_instances
  ADD COLUMN IF NOT EXISTS trigger_node_id    TEXT NULL,
  ADD COLUMN IF NOT EXISTS form_submission_id UUID NULL;

-- Lightweight audit of form submissions. The materialized inputs live on
-- jm_workflow_instances; this table records the raw submission for debugging.
CREATE TABLE jm_form_submissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id          UUID NOT NULL,
  workflow_version_id  UUID NOT NULL,
  submitted_by_user_id TEXT NULL,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_values           JSONB NOT NULL,
  workflow_instance_id UUID NULL
);

CREATE INDEX idx_jm_form_submissions_workflow ON jm_form_submissions (workflow_id);
