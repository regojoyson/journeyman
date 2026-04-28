-- 002_identity.sql — User/Org/Membership + auth tables. Uses jm_ prefix.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jm_orgs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jm_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jm_auth_identities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  secret_hash  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE IF NOT EXISTS jm_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS jm_refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  active_org_id UUID REFERENCES jm_orgs(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jm_api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id       UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jm_system_state (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bootstrapped_at TIMESTAMPTZ
);
INSERT INTO jm_system_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_jm_memberships_org ON jm_memberships (org_id);
CREATE INDEX IF NOT EXISTS idx_jm_auth_identities_user ON jm_auth_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_jm_refresh_tokens_user ON jm_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_jm_api_tokens_user ON jm_api_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_jm_api_tokens_org  ON jm_api_tokens (org_id);
