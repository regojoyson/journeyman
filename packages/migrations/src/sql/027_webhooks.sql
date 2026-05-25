-- 027_webhooks.sql
-- Promote webhooks to a first-class resource. A new jm_webhooks table holds
-- per-tenant webhook configurations (URL token, auth config, schema, etc.),
-- and jm_webhook_events gains a nullable FK to it so new ingests can be
-- attributed back to their webhook of origin. Existing events stay with
-- webhook_id = NULL and continue to work via the legacy /webhooks/:provider
-- route, which is unchanged in this migration.

BEGIN;

CREATE TABLE IF NOT EXISTS jm_webhooks (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one of org_id / user_id is non-null. Enforced by CHECK below.
  org_id                  UUID NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  user_id                 UUID NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT NULL,
  preset                  TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('ticket','git')),
  tenant_token            TEXT NOT NULL UNIQUE,
  auth                    JSONB NOT NULL,
  payload_schema          JSONB NULL,
  schema_validation       TEXT NOT NULL DEFAULT 'off'
                              CHECK (schema_validation IN ('off','warn','reject')),
  schema_inferred_from    JSONB NULL,
  event_type_path         TEXT NULL,
  delivery_id_header      TEXT NULL,
  correlation_suggestions JSONB NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at              TIMESTAMPTZ NULL,
  last_event_at           TIMESTAMPTZ NULL,
  CONSTRAINT jm_webhooks_scope_xor CHECK (
    (org_id IS NOT NULL AND user_id IS NULL) OR
    (org_id IS NULL AND user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS jm_webhooks_org_idx  ON jm_webhooks(org_id)  WHERE org_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS jm_webhooks_user_idx ON jm_webhooks(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE jm_webhook_events
  ADD COLUMN IF NOT EXISTS webhook_id UUID NULL
    REFERENCES jm_webhooks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jm_webhook_events_webhook_id_idx
  ON jm_webhook_events(webhook_id) WHERE webhook_id IS NOT NULL;

COMMIT;
