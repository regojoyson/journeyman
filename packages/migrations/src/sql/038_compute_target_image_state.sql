-- 038_compute_target_image_state.sql
-- Spec B: managed compute-target images. Adds the build lifecycle columns to
-- jm_compute_targets. Append-only; existing rows default to image_state='none'
-- (meaning "no managed image → use the default runner box").
ALTER TABLE jm_compute_targets
  ADD COLUMN IF NOT EXISTS image_state       TEXT NOT NULL DEFAULT 'none'
    CHECK (image_state IN ('none','pending','building','ready','failed')),
  ADD COLUMN IF NOT EXISTS image_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS image_ref         TEXT,
  ADD COLUMN IF NOT EXISTS image_error       TEXT,
  ADD COLUMN IF NOT EXISTS image_built_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS build_owner       TEXT,
  ADD COLUMN IF NOT EXISTS build_lease_until TIMESTAMPTZ;

-- Claimable-work lookup for the build loop (pending, or a stale building lease).
CREATE INDEX IF NOT EXISTS idx_jm_compute_targets_build
  ON jm_compute_targets (image_state, build_lease_until);
