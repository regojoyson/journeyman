-- 044_agents.sql — custom agent definitions (scope: user/org).

CREATE TABLE IF NOT EXISTS jm_agents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  user_id     UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
  enabled     BOOLEAN NOT NULL DEFAULT false,
  -- Full agent config (instructions, inputs, provider, model, tools, repos,
  -- permissions, notifications, behavior, triggers, outputMode/Fields) as one document.
  definition  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID NOT NULL REFERENCES jm_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_agents_scope_name_unique
    UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_agents_org_user ON jm_agents (org_id, user_id);
