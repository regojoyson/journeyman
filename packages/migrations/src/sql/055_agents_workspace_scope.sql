-- 055_agents_workspace_scope.sql
-- Agents become workspace-scoped (org_id retained, derived from the workspace).
-- Clean break: existing agent rows carry no workspace.
DELETE FROM jm_agents;  -- cascades to jm_agent_api_tokens / jm_agent_idempotency / jm_agent_schedule_state
ALTER TABLE jm_agents DROP CONSTRAINT IF EXISTS jm_agents_scope_name_unique;
DROP INDEX IF EXISTS idx_jm_agents_org_user;
ALTER TABLE jm_agents DROP COLUMN scope, DROP COLUMN user_id;
ALTER TABLE jm_agents
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
ALTER TABLE jm_agents
  ADD CONSTRAINT jm_agents_name_unique UNIQUE (workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_jm_agents_workspace ON jm_agents (workspace_id);
