-- Phase 1 schema. New tables only — legacy pipeline tables (if any) untouched.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS jm_flows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   TEXT,
  name            TEXT NOT NULL,
  description     TEXT,
  current_version_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jm_flow_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID NOT NULL REFERENCES jm_flows(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  definition      JSONB NOT NULL,
  created_by_user_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, version_number)
);

ALTER TABLE jm_flows
  ADD CONSTRAINT jm_flows_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES jm_flow_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS jm_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id      UUID NOT NULL REFERENCES jm_flow_versions(id),
  status               TEXT NOT NULL,
  trigger_source       TEXT NOT NULL,
  started_by_user_id   TEXT,
  engine_workflow_id   TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  duration_ms          INTEGER,
  failed_at_node_id    TEXT,
  inputs               JSONB NOT NULL DEFAULT '{}'::jsonb,
  outputs              JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jm_runs_status_idx       ON jm_runs (status);
CREATE INDEX IF NOT EXISTS jm_runs_engine_wfid_idx  ON jm_runs (engine_workflow_id);
CREATE INDEX IF NOT EXISTS jm_runs_flow_version_idx ON jm_runs (flow_version_id);

CREATE TABLE IF NOT EXISTS jm_run_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  node_id     TEXT,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jm_run_events_run_idx ON jm_run_events (run_id, id);

CREATE TABLE IF NOT EXISTS jm_node_executions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  node_id       TEXT NOT NULL,
  attempt       INTEGER NOT NULL,
  status        TEXT NOT NULL,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  input         JSONB NOT NULL DEFAULT '{}'::jsonb,
  output        JSONB,
  error_class   TEXT,
  error_message TEXT,
  UNIQUE (run_id, node_id, attempt)
);
