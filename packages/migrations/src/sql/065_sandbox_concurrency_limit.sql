-- Per-sandbox concurrency limit + per-sandbox instance attribution.

-- The cap. NULL = unlimited (the default for all existing rows).
ALTER TABLE jm_sandboxes
  ADD COLUMN IF NOT EXISTS max_concurrent_instances integer;

-- Which sandbox an instance belongs to, so we can count per sandbox record
-- (not per type). uuid to match jm_sandboxes.id; nullable, no FK — instances
-- may outlive their sandbox, and pre-existing rows stay NULL and drain out.
ALTER TABLE jm_sandbox_instances
  ADD COLUMN IF NOT EXISTS sandbox_id uuid;

-- Speeds up the per-sandbox capacity count (sandbox_id + status filter).
CREATE INDEX IF NOT EXISTS idx_jm_sandbox_instances_sandbox_status
  ON jm_sandbox_instances (sandbox_id, status);
