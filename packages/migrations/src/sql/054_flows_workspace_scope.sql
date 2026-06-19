-- 054_flows_workspace_scope.sql
-- Flows + instances become workspace-scoped; grant tables removed. Clean break.

-- Drop dependent grant tables first.
DROP TABLE IF EXISTS jm_workflow_instance_grants;
DROP TABLE IF EXISTS jm_workflow_grants;

-- Clean break: existing flows/versions/instances carry no workspace.
DELETE FROM jm_workflow_instances;
DELETE FROM jm_workflow_versions;
DELETE FROM jm_workflows;

-- Flows: add workspace_id, drop legacy owner tombstone.
ALTER TABLE jm_workflows DROP COLUMN IF EXISTS owner_user_id;
ALTER TABLE jm_workflows
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_jm_workflows_workspace ON jm_workflows (workspace_id);

-- Instances: replace scope snapshot with workspace_id.
ALTER TABLE jm_workflow_instances DROP COLUMN workflow_scope_snapshot;
ALTER TABLE jm_workflow_instances
  ADD COLUMN workspace_id UUID REFERENCES jm_workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jm_workflow_instances_workspace ON jm_workflow_instances (workspace_id);
