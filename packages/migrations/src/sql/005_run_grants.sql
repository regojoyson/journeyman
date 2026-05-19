-- 005_run_grants.sql — run-level grants for user/org/platform-admin visibility.

-- 1) Grants table.
CREATE TABLE IF NOT EXISTS jm_run_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE,
  principal_type  TEXT NOT NULL CHECK (principal_type IN ('user','org','global')),
  principal_id    UUID NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES jm_users(id) ON DELETE SET NULL,
  CONSTRAINT jm_run_grants_principal_shape CHECK (
    (principal_type = 'global' AND principal_id IS NULL)
    OR (principal_type IN ('user','org') AND principal_id IS NOT NULL)
  ),
  CONSTRAINT jm_run_grants_unique UNIQUE NULLS NOT DISTINCT (run_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_jm_run_grants_run        ON jm_run_grants (run_id);
CREATE INDEX IF NOT EXISTS idx_jm_run_grants_principal  ON jm_run_grants (principal_type, principal_id);

-- 2) Backfill: every existing run gets a ('user', started_by_user_id, 'owner') grant
--    and (best-effort) a ('org', current primary org, 'viewer') grant.
--    jm_runs.started_by_user_id is TEXT (legacy) — cast to UUID, skip non-UUID rows.
INSERT INTO jm_run_grants (run_id, principal_type, principal_id, role, created_by)
SELECT r.id, 'user', r.started_by_user_id::uuid, 'owner', r.started_by_user_id::uuid
FROM jm_runs r
WHERE r.started_by_user_id IS NOT NULL
  AND r.started_by_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM jm_run_grants g WHERE g.run_id = r.id AND g.role = 'owner'
  );

INSERT INTO jm_run_grants (run_id, principal_type, principal_id, role, created_by)
SELECT r.id, 'org', m.org_id, 'viewer', r.started_by_user_id::uuid
FROM jm_runs r
JOIN LATERAL (
  SELECT org_id FROM jm_memberships
  WHERE user_id = r.started_by_user_id::uuid
  ORDER BY created_at ASC LIMIT 1
) m ON TRUE
WHERE r.started_by_user_id IS NOT NULL
  AND r.started_by_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM jm_run_grants g
    WHERE g.run_id = r.id AND g.principal_type = 'org' AND g.principal_id = m.org_id
  );
