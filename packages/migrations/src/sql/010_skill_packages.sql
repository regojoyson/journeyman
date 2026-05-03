-- 010_skill_packages.sql — user/org-scope skill package registry.

CREATE TABLE IF NOT EXISTS jm_skill_packages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope          TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  user_id        UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  git_url        TEXT NOT NULL,
  name           TEXT NOT NULL,
  local_path     TEXT,
  commit_sha     TEXT,
  install_status TEXT NOT NULL DEFAULT 'pending'
                   CHECK (install_status IN ('pending', 'installing', 'ready', 'error')),
  install_error  TEXT,
  enabled_skills TEXT[] NOT NULL DEFAULT '{}',
  cli_type       TEXT NOT NULL DEFAULT 'claude'
                   CHECK (cli_type IN ('claude', 'opencode', 'codex')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_skill_packages_scope_unique UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, git_url)
);

CREATE INDEX IF NOT EXISTS idx_jm_skill_packages_org_user ON jm_skill_packages (org_id, user_id);
