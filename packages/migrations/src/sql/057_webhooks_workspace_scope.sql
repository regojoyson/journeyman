-- 057_webhooks_workspace_scope.sql
-- Webhooks become workspace-scoped (org_id retained, derived from the workspace).
-- Clean break: existing rows carry no workspace.
DELETE FROM jm_webhooks;
ALTER TABLE jm_webhooks DROP CONSTRAINT IF EXISTS jm_webhooks_scope_xor;
DROP INDEX IF EXISTS jm_webhooks_org_idx;
DROP INDEX IF EXISTS jm_webhooks_user_idx;
ALTER TABLE jm_webhooks DROP COLUMN user_id;
-- org_id is RETAINED (derived from the workspace at create; used for secret resolution).
-- Make it NOT NULL now that the XOR constraint is gone:
ALTER TABLE jm_webhooks ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE jm_webhooks
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_jm_webhooks_workspace ON jm_webhooks (workspace_id);
