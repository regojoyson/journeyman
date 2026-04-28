-- 004_flow_scopes.sql — flow grants + run snapshots + platform admin flag.

-- 1) Pre-flight: refuse migration if any flow has a NULL owner.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM jm_flows WHERE owner_user_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 004 aborted: % flows have NULL owner_user_id', n;
  END IF;
END $$;

-- 2) Platform admin flag.
ALTER TABLE jm_users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Bootstrap: first user becomes platform admin (idempotent — only flips if no platform admin yet).
DO $$
DECLARE first_user UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jm_users WHERE is_platform_admin = TRUE) THEN
    SELECT id INTO first_user FROM jm_users ORDER BY created_at ASC LIMIT 1;
    IF first_user IS NOT NULL THEN
      UPDATE jm_users SET is_platform_admin = TRUE WHERE id = first_user;
    END IF;
  END IF;
END $$;

-- 4) Grants table.
CREATE TABLE IF NOT EXISTS jm_flow_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID NOT NULL REFERENCES jm_flows(id) ON DELETE CASCADE,
  principal_type  TEXT NOT NULL CHECK (principal_type IN ('user','org','global')),
  principal_id    UUID NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES jm_users(id) ON DELETE SET NULL,
  CONSTRAINT jm_flow_grants_principal_shape CHECK (
    (principal_type = 'global' AND principal_id IS NULL)
    OR (principal_type IN ('user','org') AND principal_id IS NOT NULL)
  ),
  CONSTRAINT jm_flow_grants_unique UNIQUE NULLS NOT DISTINCT (flow_id, principal_type, principal_id)
);
CREATE INDEX IF NOT EXISTS idx_jm_flow_grants_flow ON jm_flow_grants (flow_id);
CREATE INDEX IF NOT EXISTS idx_jm_flow_grants_user ON jm_flow_grants (principal_type, principal_id) WHERE principal_type = 'user';
CREATE INDEX IF NOT EXISTS idx_jm_flow_grants_org  ON jm_flow_grants (principal_type, principal_id) WHERE principal_type = 'org';

-- 5) Backfill: one owner grant per existing flow.
--    Existing jm_flows.owner_user_id is TEXT (legacy) — cast to UUID.

-- Pre-flight: fail loudly if any owner_user_id is non-UUID (legacy data must be cleaned up first).
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT COUNT(*) INTO n FROM jm_flows
   WHERE owner_user_id IS NOT NULL
     AND owner_user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 004 aborted: % flows have non-UUID owner_user_id (legacy data must be cleaned up first)', n;
  END IF;
END $$;

INSERT INTO jm_flow_grants (id, flow_id, principal_type, principal_id, role, created_by)
SELECT gen_random_uuid(), f.id, 'user', f.owner_user_id::uuid, 'owner', f.owner_user_id::uuid
FROM jm_flows f
WHERE f.owner_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NOT EXISTS (
    SELECT 1 FROM jm_flow_grants g WHERE g.flow_id = f.id AND g.role = 'owner'
  );

-- 6) Add audit column on flows; populate from owner_user_id legacy column.
ALTER TABLE jm_flows
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES jm_users(id) ON DELETE SET NULL;

UPDATE jm_flows
SET created_by_user_id = owner_user_id::uuid
WHERE created_by_user_id IS NULL
  AND owner_user_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

-- Note: owner_user_id (TEXT) is kept as a tombstone for one release. The application reads
-- ownership exclusively via jm_flow_grants from this point on. Drop in migration 005.

-- 7) Run snapshot columns.
ALTER TABLE jm_runs
  ADD COLUMN IF NOT EXISTS flow_id              UUID REFERENCES jm_flows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flow_name_snapshot   TEXT,
  ADD COLUMN IF NOT EXISTS flow_scope_snapshot  TEXT,
  ADD COLUMN IF NOT EXISTS definition_snapshot  JSONB;

-- Backfill: pull from existing flow_version_id.
UPDATE jm_runs r
SET flow_id              = fv.flow_id,
    flow_name_snapshot   = COALESCE(f.name, '<deleted>'),
    flow_scope_snapshot  = 'user',
    definition_snapshot  = fv.definition
FROM jm_flow_versions fv
LEFT JOIN jm_flows f ON f.id = fv.flow_id
WHERE r.flow_version_id = fv.id
  AND r.flow_name_snapshot IS NULL;

-- For any run whose flow_version_id is dangling (shouldn't happen but be safe):
UPDATE jm_runs
SET flow_name_snapshot  = COALESCE(flow_name_snapshot, '<unknown>'),
    flow_scope_snapshot = COALESCE(flow_scope_snapshot, 'user'),
    definition_snapshot = COALESCE(definition_snapshot, '{}'::jsonb);

ALTER TABLE jm_runs
  ALTER COLUMN flow_name_snapshot   SET NOT NULL,
  ALTER COLUMN flow_scope_snapshot  SET NOT NULL,
  ALTER COLUMN definition_snapshot  SET NOT NULL,
  ADD CONSTRAINT jm_runs_flow_scope_check CHECK (flow_scope_snapshot IN ('user','org','global'));

-- 8) Relax flow_version_id FK to ON DELETE SET NULL.
ALTER TABLE jm_runs DROP CONSTRAINT IF EXISTS jm_runs_flow_version_id_fkey;
ALTER TABLE jm_runs
  ALTER COLUMN flow_version_id DROP NOT NULL,
  ADD CONSTRAINT jm_runs_flow_version_id_fkey
    FOREIGN KEY (flow_version_id) REFERENCES jm_flow_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jm_runs_flow_id_idx ON jm_runs (flow_id);
