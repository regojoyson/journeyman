-- 058_coding_models_org_scope.sql
-- Coding models become org-scoped, and each model can bind an org secret for its API key.
-- Existing rows are preserved and assigned to the earliest org (single designated org).

ALTER TABLE jm_coding_models ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES jm_orgs(id) ON DELETE CASCADE;
ALTER TABLE jm_coding_models ADD COLUMN IF NOT EXISTS api_key_secret_id UUID REFERENCES jm_secrets(id) ON DELETE RESTRICT;

-- Backfill existing rows to the earliest org so nothing is orphaned.
UPDATE jm_coding_models
   SET org_id = (SELECT id FROM jm_orgs ORDER BY created_at ASC LIMIT 1)
 WHERE org_id IS NULL;

-- If there are coding models but no orgs at all, the backfill above leaves NULLs;
-- delete those rather than block the NOT NULL (only possible on a brand-new/empty install).
DELETE FROM jm_coding_models WHERE org_id IS NULL;

ALTER TABLE jm_coding_models ALTER COLUMN org_id SET NOT NULL;

-- Re-scope uniqueness and the default index to be per-org.
ALTER TABLE jm_coding_models DROP CONSTRAINT IF EXISTS jm_coding_models_provider_model_id_key;
DROP INDEX IF EXISTS jm_coding_models_provider_idx;
DROP INDEX IF EXISTS jm_coding_models_one_default_per_provider;

ALTER TABLE jm_coding_models
  ADD CONSTRAINT jm_coding_models_org_provider_model_key UNIQUE (org_id, provider, model_id);

CREATE INDEX jm_coding_models_org_provider_idx
  ON jm_coding_models (org_id, provider) WHERE enabled = true;

CREATE UNIQUE INDEX jm_coding_models_one_default_per_org_provider
  ON jm_coding_models (org_id, provider) WHERE is_default = true;
