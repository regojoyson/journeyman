CREATE TABLE IF NOT EXISTS jm_workers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          TEXT NOT NULL CHECK (scope IN ('user','org','system')),
  org_id         UUID REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id        UUID REFERENCES jm_users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('per-instance','shared')),
  connectivity   TEXT CHECK (connectivity IN ('push','agent')),
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default     BOOLEAN NOT NULL DEFAULT false,
  tags           JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID REFERENCES jm_users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_workers_scope_shape CHECK (
       (scope = 'system' AND org_id IS NULL     AND user_id IS NULL)
    OR (scope = 'org'    AND org_id IS NOT NULL AND user_id IS NULL)
    OR (scope = 'user'   AND org_id IS NOT NULL AND user_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_jm_workers_org_user ON jm_workers (org_id, user_id);

-- Built-in default: the Local Workspace worker (in-process, no isolation).
INSERT INTO jm_workers (scope, name, type, execution_mode, connectivity, config, is_default, enabled)
SELECT 'system', 'Local Workspace', 'local', 'shared', NULL, '{}'::jsonb, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM jm_workers WHERE scope = 'system' AND type = 'local'
);
