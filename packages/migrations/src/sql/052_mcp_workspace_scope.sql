-- 052_mcp_workspace_scope.sql
-- MCP instances become workspace-only. Clean break: existing rows carry no
-- workspace, so they are dropped.

DELETE FROM jm_mcp_instances;

ALTER TABLE jm_mcp_instances DROP CONSTRAINT IF EXISTS jm_mcp_instances_scope_unique;
DROP INDEX IF EXISTS idx_jm_mcp_instances_org_user;

ALTER TABLE jm_mcp_instances
  DROP COLUMN org_id,
  DROP COLUMN user_id;

ALTER TABLE jm_mcp_instances
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;

ALTER TABLE jm_mcp_instances
  ADD CONSTRAINT jm_mcp_instances_scope_unique UNIQUE (workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_jm_mcp_instances_workspace ON jm_mcp_instances (workspace_id);
