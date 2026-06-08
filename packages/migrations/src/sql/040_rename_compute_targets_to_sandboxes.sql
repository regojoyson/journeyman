-- 040_rename_compute_targets_to_sandboxes.sql
-- Behavior-preserving rename of jm_compute_targets -> jm_sandboxes.
-- Data-preserving: ALTER ... RENAME does not copy or drop rows.
ALTER TABLE IF EXISTS jm_compute_targets RENAME TO jm_sandboxes;
ALTER INDEX IF EXISTS idx_jm_compute_targets_org_user RENAME TO idx_jm_sandboxes_org_user;
ALTER INDEX IF EXISTS idx_jm_compute_targets_build RENAME TO idx_jm_sandboxes_build;
ALTER TABLE jm_sandboxes RENAME CONSTRAINT jm_compute_targets_scope_shape TO jm_sandboxes_scope_shape;
