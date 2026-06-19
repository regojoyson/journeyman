-- 056_connections_workspace_scope.sql
-- Connections become workspace-scoped (org_id retained, derived from the workspace).
-- Clean break: existing rows carry no workspace.
DELETE FROM jm_connections;
ALTER TABLE jm_connections DROP CONSTRAINT IF EXISTS jm_connections_scope_label_unique;
DROP INDEX IF EXISTS idx_jm_connections_org_user;
ALTER TABLE jm_connections DROP COLUMN scope, DROP COLUMN user_id;
ALTER TABLE jm_connections
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
ALTER TABLE jm_connections
  ADD CONSTRAINT jm_connections_label_unique UNIQUE (workspace_id, label);
CREATE INDEX IF NOT EXISTS idx_jm_connections_workspace ON jm_connections (workspace_id);
-- keep idx_jm_connections_category (org_id, category) -- still valid.
