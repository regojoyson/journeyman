-- 064_token_usage.sql — append-only per-(call×model) token usage, workspace-scoped.
-- Source of truth for the future usage dashboard. cost_usd is reserved (NULL this phase).

CREATE TABLE IF NOT EXISTS jm_token_usage (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID REFERENCES jm_workspaces(id) ON DELETE CASCADE,
  org_id                UUID,
  workflow_id           UUID,
  workflow_version_id   UUID,
  workflow_name         TEXT,
  workflow_instance_id  UUID NOT NULL REFERENCES jm_workflow_instances(id) ON DELETE CASCADE,
  node_id               TEXT NOT NULL,
  step_type             TEXT NOT NULL,
  step_name             TEXT,
  attempt               INTEGER NOT NULL DEFAULT 1,
  agent_id              UUID,
  agent_name            TEXT,
  triggered_by_user_id  UUID,
  provider              TEXT NOT NULL,
  vendor                TEXT,
  model                 TEXT,
  outcome               TEXT NOT NULL DEFAULT 'success',
  input_tokens          BIGINT,
  output_tokens         BIGINT,
  cache_read_tokens     BIGINT,
  cache_creation_tokens BIGINT,
  reasoning_tokens      BIGINT,
  total_tokens          BIGINT,
  usage_reported        BOOLEAN NOT NULL DEFAULT true,
  cost_usd              NUMERIC,
  raw_usage             JSONB,
  session_id            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jm_token_usage_ws_created_idx   ON jm_token_usage (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS jm_token_usage_ws_workflow_idx  ON jm_token_usage (workspace_id, workflow_id, created_at);
CREATE INDEX IF NOT EXISTS jm_token_usage_instance_idx     ON jm_token_usage (workflow_instance_id);
CREATE INDEX IF NOT EXISTS jm_token_usage_agent_idx        ON jm_token_usage (agent_id);
CREATE INDEX IF NOT EXISTS jm_token_usage_ws_model_idx     ON jm_token_usage (workspace_id, provider, model);
CREATE INDEX IF NOT EXISTS jm_token_usage_ws_vendor_idx    ON jm_token_usage (workspace_id, vendor);

-- Idempotency: Conductor is at-least-once. A node maps to one terminal call; multi-model
-- calls produce distinct `model`s. COALESCE(model,'') so NULL-model (usage_reported=false)
-- rows also dedupe on redelivery.
CREATE UNIQUE INDEX IF NOT EXISTS jm_token_usage_dedupe_idx
  ON jm_token_usage (workflow_instance_id, node_id, attempt, provider, COALESCE(model, ''));
