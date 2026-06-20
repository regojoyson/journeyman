-- 060_global_mcp_scope.sql
-- Add global scope to MCP instances.
-- workspace_id becomes nullable; scope column distinguishes the two cases.

ALTER TABLE jm_mcp_instances
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'workspace'
    CHECK (scope IN ('workspace', 'global'));

ALTER TABLE jm_mcp_instances
  ALTER COLUMN workspace_id DROP NOT NULL;

ALTER TABLE jm_mcp_instances
  ADD CONSTRAINT jm_mcp_instances_scope_coherence CHECK (
    (scope = 'workspace' AND workspace_id IS NOT NULL) OR
    (scope = 'global'    AND workspace_id IS NULL)
  );

-- Global MCP names must be unique across the platform.
CREATE UNIQUE INDEX jm_mcp_instances_global_name_unique
  ON jm_mcp_instances (name)
  WHERE scope = 'global';
