-- 048_audit_log.sql — append-only audit trail for sensitive agent/connection actions (§16).

CREATE TABLE IF NOT EXISTS jm_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES jm_users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,          -- e.g. "agent.enable", "connection.delete"
  target_type    TEXT NOT NULL,          -- e.g. "agent", "connection", "org_settings"
  target_id      TEXT,                   -- nullable (e.g. org-wide settings)
  detail         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jm_audit_log_org_created
  ON jm_audit_log (org_id, created_at DESC);
