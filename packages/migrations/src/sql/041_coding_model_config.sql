-- 041_coding_model_config.sql
-- Provider-specific config bag for coding models (OpenCode custom endpoints:
-- baseUrl / npm / apiKeySlot). Empty object for all existing/cloud models.
ALTER TABLE jm_coding_models ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
