-- 046_agent_triggers.sql — Phase 3 automated triggers: API tokens, idempotency, schedule state.
-- (The webhook→agent binding lands with the Phase 3b webhook-ingest work.)

-- Per-agent API tokens for the /fire endpoint (hashed; plaintext shown once).
CREATE TABLE IF NOT EXISTS jm_agent_api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES jm_agents(id) ON DELETE CASCADE,
  org_id       UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'api',
  token_hash   TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jm_agent_api_tokens_agent ON jm_agent_api_tokens (agent_id);

-- Idempotency for API /fire calls (Idempotency-Key header).
CREATE TABLE IF NOT EXISTS jm_agent_idempotency (
  agent_id             UUID NOT NULL REFERENCES jm_agents(id) ON DELETE CASCADE,
  idempotency_key      TEXT NOT NULL,
  workflow_instance_id UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, idempotency_key)
);

-- Durable scheduler state (one row per scheduled, enabled agent).
CREATE TABLE IF NOT EXISTS jm_agent_schedule_state (
  agent_id      UUID PRIMARY KEY REFERENCES jm_agents(id) ON DELETE CASCADE,
  cron          TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  next_due_at   TIMESTAMPTZ NOT NULL,
  last_fired_at TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jm_agent_schedule_due ON jm_agent_schedule_state (next_due_at);
