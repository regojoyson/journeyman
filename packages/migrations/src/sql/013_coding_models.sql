-- 013_coding_models.sql
-- Admin-managed catalog of coding models available to flows.

CREATE TABLE jm_coding_models (
  id                  TEXT PRIMARY KEY,
  provider            TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  label               TEXT NOT NULL,
  description         TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  deprecated          BOOLEAN NOT NULL DEFAULT false,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  supports_thinking   BOOLEAN NOT NULL DEFAULT false,
  context_window      INTEGER,
  input_cost_per_1m   NUMERIC(10,4),
  output_cost_per_1m  NUMERIC(10,4),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model_id)
);

CREATE INDEX jm_coding_models_provider_idx
  ON jm_coding_models (provider) WHERE enabled = true;

CREATE UNIQUE INDEX jm_coding_models_one_default_per_provider
  ON jm_coding_models (provider) WHERE is_default = true;
