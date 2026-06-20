-- 062_workflow_drafts.sql
-- Draft / promote / publish model:
--   * draft_definition: the single mutable working copy (always present)
--   * current_version_id -> published_version_id (what actually runs; NULL = not live)
--   * jm_workflow_versions becomes a pure immutable history (written only on promote)

ALTER TABLE jm_workflows
  ADD COLUMN draft_definition          JSONB,
  ADD COLUMN draft_updated_at          TIMESTAMPTZ,
  ADD COLUMN draft_updated_by_user_id  TEXT;

ALTER TABLE jm_workflows
  RENAME COLUMN current_version_id TO published_version_id;

-- Seed every workflow's draft from its current/published version (status-agnostic).
UPDATE jm_workflows w
SET draft_definition         = v.definition,
    draft_updated_at         = w.updated_at,
    draft_updated_by_user_id = v.created_by_user_id
FROM jm_workflow_versions v
WHERE w.published_version_id = v.id;

-- Guard: any workflow without a version gets an empty graph.
UPDATE jm_workflows
SET draft_definition = '{"schemaVersion":2,"nodes":[],"edges":[]}'::jsonb,
    draft_updated_at = updated_at
WHERE draft_definition IS NULL;

-- Enforce invariant: only 'ready' workflows keep a published pointer.
UPDATE jm_workflows
SET published_version_id = NULL
WHERE status <> 'ready';

ALTER TABLE jm_workflows
  ALTER COLUMN draft_definition SET NOT NULL;
