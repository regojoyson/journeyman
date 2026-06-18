-- 047_agent_safety.sql — agent safety rails (§15.1).
-- Org-level kill-switch + default limits, and a per-agent/day run+usage tally.
-- Per-agent limit overrides live in jm_agents.definition JSONB (no column here).

CREATE TABLE IF NOT EXISTS jm_org_agent_settings (
  org_id              UUID PRIMARY KEY REFERENCES jm_orgs(id) ON DELETE CASCADE,
  paused              BOOLEAN NOT NULL DEFAULT false,
  max_concurrent_runs INTEGER,
  daily_run_cap       INTEGER,
  budget              JSONB,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jm_agent_run_counters (
  org_id    UUID NOT NULL REFERENCES jm_orgs(id)   ON DELETE CASCADE,
  agent_id  UUID NOT NULL REFERENCES jm_agents(id) ON DELETE CASCADE,
  day       DATE NOT NULL,
  runs      INTEGER NOT NULL DEFAULT 0,
  tokens    BIGINT  NOT NULL DEFAULT 0,
  cost_usd  NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, day)
);

CREATE INDEX IF NOT EXISTS idx_jm_agent_run_counters_org_day
  ON jm_agent_run_counters (org_id, day);
