-- 018_rename_flows_runs.sql
-- Rename flow → workflow, run → workflow_instance (pure renames, no data changes)

-- Tables
ALTER TABLE jm_flows             RENAME TO jm_workflows;
ALTER TABLE jm_flow_versions     RENAME TO jm_workflow_versions;
ALTER TABLE jm_runs              RENAME TO jm_workflow_instances;
ALTER TABLE jm_run_events        RENAME TO jm_workflow_instance_events;
ALTER TABLE jm_run_grants        RENAME TO jm_workflow_instance_grants;

-- Columns: jm_workflow_versions
ALTER TABLE jm_workflow_versions RENAME COLUMN flow_id TO workflow_id;

-- Columns: jm_workflow_instances
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_id            TO workflow_id;
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_version_id    TO workflow_version_id;
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_name_snapshot TO workflow_name_snapshot;
ALTER TABLE jm_workflow_instances RENAME COLUMN flow_scope_snapshot TO workflow_scope_snapshot;

-- Columns: jm_workflow_instance_events
ALTER TABLE jm_workflow_instance_events RENAME COLUMN run_id TO workflow_instance_id;

-- Columns: jm_workflow_instance_grants
ALTER TABLE jm_workflow_instance_grants RENAME COLUMN run_id TO workflow_instance_id;

-- Columns: jm_node_executions
ALTER TABLE jm_node_executions RENAME COLUMN run_id TO workflow_instance_id;

-- Indexes
ALTER INDEX IF EXISTS jm_runs_status_idx          RENAME TO jm_workflow_instances_status_idx;
ALTER INDEX IF EXISTS jm_runs_engine_wfid_idx     RENAME TO jm_workflow_instances_engine_wfid_idx;
ALTER INDEX IF EXISTS jm_runs_flow_version_idx    RENAME TO jm_workflow_instances_workflow_version_idx;
ALTER INDEX IF EXISTS jm_runs_flow_id_idx         RENAME TO jm_workflow_instances_workflow_id_idx;
ALTER INDEX IF EXISTS jm_runs_webhook_event_idx   RENAME TO jm_workflow_instances_webhook_event_idx;
ALTER INDEX IF EXISTS jm_run_events_run_idx       RENAME TO jm_workflow_instance_events_idx;
ALTER INDEX IF EXISTS idx_jm_run_grants_run       RENAME TO idx_jm_workflow_instance_grants_instance;
ALTER INDEX IF EXISTS idx_jm_run_grants_principal RENAME TO idx_jm_workflow_instance_grants_principal;
ALTER INDEX IF EXISTS jm_run_grants_unique        RENAME TO jm_workflow_instance_grants_unique;
