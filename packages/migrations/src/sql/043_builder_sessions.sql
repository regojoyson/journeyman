-- 043_builder_sessions.sql
-- User/org-scoped conversational AI-builder chat sessions: the message
-- transcript and the latest build plan, so a build can be left and resumed.

CREATE TABLE IF NOT EXISTS jm_builder_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id         UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'applied', 'archived')),
  messages        JSONB NOT NULL DEFAULT '[]'::jsonb,
  build_plan      JSONB,
  applied_flow_id UUID,
  created_by      UUID NOT NULL REFERENCES jm_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_builder_sessions_scope_name_unique
    UNIQUE NULLS NOT DISTINCT (org_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_builder_sessions_org_user
  ON jm_builder_sessions (org_id, user_id);
