-- 051_skills_workspace_scope.sql
-- Skill packages become workspace-only. Clean break: existing rows carry no
-- workspace, so they are dropped and re-installed under a workspace.

DELETE FROM jm_skill_packages;

ALTER TABLE jm_skill_packages DROP CONSTRAINT IF EXISTS jm_skill_packages_name_unique;
ALTER TABLE jm_skill_packages DROP CONSTRAINT IF EXISTS jm_skill_packages_scope_unique;
DROP INDEX IF EXISTS idx_jm_skill_packages_org_user;

ALTER TABLE jm_skill_packages
  DROP COLUMN scope,
  DROP COLUMN user_id,
  DROP COLUMN org_id;

ALTER TABLE jm_skill_packages
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;

ALTER TABLE jm_skill_packages
  ADD CONSTRAINT jm_skill_packages_name_unique UNIQUE (workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_jm_skill_packages_workspace ON jm_skill_packages (workspace_id);
