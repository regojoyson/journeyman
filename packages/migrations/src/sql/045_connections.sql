-- 045_connections.sql — unified connections (git + notification), scope: user/org.
-- The credential is stored encrypted (AES-256-GCM) directly on the row.

CREATE TABLE IF NOT EXISTS jm_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  user_id         UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  category        TEXT NOT NULL CHECK (category IN ('git', 'notification')),
  provider        TEXT NOT NULL,
  label           TEXT NOT NULL,
  base_url        TEXT,
  cred_ciphertext BYTEA NOT NULL,
  cred_iv         BYTEA NOT NULL,
  cred_auth_tag   BYTEA NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by      UUID NOT NULL REFERENCES jm_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_connections_scope_label_unique
    UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, label)
);

CREATE INDEX IF NOT EXISTS idx_jm_connections_org_user ON jm_connections (org_id, user_id);
CREATE INDEX IF NOT EXISTS idx_jm_connections_category ON jm_connections (org_id, category);
