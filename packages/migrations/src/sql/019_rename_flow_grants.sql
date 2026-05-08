-- 019_rename_flow_grants.sql
-- Rename jm_flow_grants → jm_workflow_grants (missed in 018)

ALTER TABLE jm_flow_grants RENAME TO jm_workflow_grants;
ALTER TABLE jm_workflow_grants RENAME COLUMN flow_id TO workflow_id;

ALTER INDEX IF EXISTS jm_flow_grants_workflow_id_idx RENAME TO jm_workflow_grants_workflow_id_idx;
ALTER INDEX IF EXISTS jm_flow_grants_unique          RENAME TO jm_workflow_grants_unique;
