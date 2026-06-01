CREATE TABLE IF NOT EXISTS jm_sandbox_instances (
  run_id       UUID PRIMARY KEY,
  type         TEXT NOT NULL,
  handle       TEXT NOT NULL,
  volume       TEXT,
  image_ref    TEXT,
  owner        TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','destroyed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  destroyed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jm_sandbox_instances_status ON jm_sandbox_instances (status);
