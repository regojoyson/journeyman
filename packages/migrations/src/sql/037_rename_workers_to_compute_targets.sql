-- 037_rename_workers_to_compute_targets.sql
-- Behavior-preserving rename of jm_workers -> jm_compute_targets (Spec A).
-- Data-preserving: ALTER ... RENAME does not copy or drop rows.
ALTER TABLE IF EXISTS jm_workers RENAME TO jm_compute_targets;
ALTER INDEX IF EXISTS idx_jm_workers_org_user RENAME TO idx_jm_compute_targets_org_user;
ALTER TABLE jm_compute_targets RENAME CONSTRAINT jm_workers_scope_shape TO jm_compute_targets_scope_shape;
