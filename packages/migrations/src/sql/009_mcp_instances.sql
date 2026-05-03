-- 009_mcp_instances.sql — user/org-scope MCP server instances.

CREATE TABLE IF NOT EXISTS jm_mcp_instances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id       UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  transport     TEXT NOT NULL CHECK (transport IN ('stdio','http','sse')),
  command       TEXT,
  args          JSONB,
  url           TEXT,
  bindings      JSONB NOT NULL DEFAULT '[]'::jsonb,
  system_prompt TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID NOT NULL REFERENCES jm_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_mcp_instances_scope_unique UNIQUE NULLS NOT DISTINCT (org_id, user_id, name),
  CONSTRAINT jm_mcp_instances_transport_shape CHECK (
    (transport = 'stdio' AND command IS NOT NULL AND url IS NULL)
    OR (transport IN ('http','sse') AND url IS NOT NULL AND command IS NULL AND args IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_jm_mcp_instances_org_user ON jm_mcp_instances (org_id, user_id);
