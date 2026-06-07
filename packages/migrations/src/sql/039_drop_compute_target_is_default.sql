-- 039_drop_compute_target_is_default.sql
-- Remove the "default compute target" concept (Spec 2026-06-07): there is no
-- global default anymore — every workflow picks its target explicitly.
ALTER TABLE jm_compute_targets DROP COLUMN IF EXISTS is_default;
