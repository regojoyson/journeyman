-- 050_sandboxes_drop_user_scope.sql
-- Drop the user tier from sandboxes. Clean break: scope='user' rows are deleted.
-- System (org_id NULL) and org (org_id set) rows are preserved.

-- 1. Delete user-scoped rows.
DELETE FROM jm_sandboxes WHERE scope = 'user';

-- 2. Replace the scope-shape CHECK (it references user_id).
ALTER TABLE jm_sandboxes DROP CONSTRAINT IF EXISTS jm_sandboxes_scope_shape;

-- 3. Drop the scope-value CHECK (auto-named; locate by its definition).
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'jm_sandboxes'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%scope%user%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE jm_sandboxes DROP CONSTRAINT %I', c);
  END IF;
END $$;

-- 4. Drop the user_id column + its index.
DROP INDEX IF EXISTS idx_jm_workers_org_user;
ALTER TABLE jm_sandboxes DROP COLUMN user_id;

-- 5. Re-add narrowed checks (org | system only).
ALTER TABLE jm_sandboxes
  ADD CONSTRAINT jm_sandboxes_scope_check CHECK (scope IN ('org','system'));
ALTER TABLE jm_sandboxes
  ADD CONSTRAINT jm_sandboxes_scope_shape CHECK (
       (scope = 'system' AND org_id IS NULL)
    OR (scope = 'org'    AND org_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_jm_sandboxes_org ON jm_sandboxes (org_id);
