-- 053_custom_steps_workspace_scope.sql
DELETE FROM jm_custom_ai_steps;
ALTER TABLE jm_custom_ai_steps DROP CONSTRAINT IF EXISTS jm_custom_ai_steps_scope_name_unique;
DROP INDEX IF EXISTS idx_jm_custom_ai_steps_org_user;
ALTER TABLE jm_custom_ai_steps
  DROP COLUMN scope, DROP COLUMN user_id, DROP COLUMN org_id;
ALTER TABLE jm_custom_ai_steps
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
ALTER TABLE jm_custom_ai_steps
  ADD CONSTRAINT jm_custom_ai_steps_name_unique UNIQUE (workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_jm_custom_ai_steps_workspace ON jm_custom_ai_steps (workspace_id);
