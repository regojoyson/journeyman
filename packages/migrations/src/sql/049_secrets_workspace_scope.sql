-- 049_secrets_workspace_scope.sql
-- Workspace scoping for secrets. Clean break: user-scoped secret rows are dropped
-- (not migrated). Org-scoped rows (user_id IS NULL) are preserved as org secrets.

-- 1. Drop user-scoped rows (clean break — not carried into the workspace model).
DELETE FROM jm_secrets WHERE user_id IS NOT NULL;

-- 2. Drop the old scope constraint + index that reference user_id.
ALTER TABLE jm_secrets DROP CONSTRAINT IF EXISTS jm_secrets_scope_unique;
DROP INDEX IF EXISTS idx_jm_secrets_org_user;

-- 3. Swap the scope column.
ALTER TABLE jm_secrets DROP COLUMN user_id;
ALTER TABLE jm_secrets
  ADD COLUMN workspace_id UUID REFERENCES jm_workspaces(id) ON DELETE CASCADE;

-- 4. New scope rules: workspace_id IS NULL => org secret; else workspace secret.
--    Unique per (org_id, workspace_id, name), treating NULL workspace as a value.
ALTER TABLE jm_secrets
  ADD CONSTRAINT jm_secrets_scope_unique
  UNIQUE NULLS NOT DISTINCT (org_id, workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_jm_secrets_org_workspace
  ON jm_secrets (org_id, workspace_id);
