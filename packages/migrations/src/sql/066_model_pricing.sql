-- 066_model_pricing.sql — org-scoped, effective-dated model pricing.
-- Source for jm_token_usage.cost_usd. One active row (effective_to IS NULL) per (org, provider, model).

CREATE TABLE IF NOT EXISTS jm_model_pricing (
  id                     TEXT PRIMARY KEY,
  org_id                 UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL,
  vendor                 TEXT,
  model                  TEXT NOT NULL,
  input_per_1m           NUMERIC(12,4),
  output_per_1m          NUMERIC(12,4),
  cache_read_per_1m      NUMERIC(12,4),
  cache_creation_per_1m  NUMERIC(12,4),
  reasoning_per_1m       NUMERIC(12,4),
  currency               TEXT NOT NULL DEFAULT 'USD',
  effective_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jm_model_pricing_lookup_idx
  ON jm_model_pricing (org_id, provider, model, effective_from DESC);

CREATE UNIQUE INDEX IF NOT EXISTS jm_model_pricing_one_active_idx
  ON jm_model_pricing (org_id, provider, model)
  WHERE effective_to IS NULL;
