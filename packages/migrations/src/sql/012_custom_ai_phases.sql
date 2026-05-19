-- 012_custom_ai_phases.sql — user/org-scope custom AI phase definitions.

CREATE TABLE IF NOT EXISTS jm_custom_ai_phases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  user_id          UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  input_fields     JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_mode      TEXT NOT NULL DEFAULT 'none'
                     CHECK (output_mode IN ('none', 'text', 'structured')),
  output_schema    JSONB,
  prompt_template  TEXT NOT NULL DEFAULT '',
  needs_workspace  BOOLEAN NOT NULL DEFAULT false,
  default_provider TEXT,
  default_mcp_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by       UUID NOT NULL REFERENCES jm_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_custom_ai_phases_scope_name_unique
    UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_custom_ai_phases_org_user
  ON jm_custom_ai_phases (org_id, user_id);
