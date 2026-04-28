-- 003_secrets.sql — encrypted user/org-scope secrets.

CREATE TABLE IF NOT EXISTS jm_secrets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  user_id       UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  ciphertext    BYTEA NOT NULL,
  iv            BYTEA NOT NULL,
  auth_tag      BYTEA NOT NULL,
  created_by    UUID NOT NULL REFERENCES jm_users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_secrets_scope_unique UNIQUE NULLS NOT DISTINCT (org_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_secrets_org_user ON jm_secrets (org_id, user_id);
