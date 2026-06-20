ALTER TABLE jm_agent_api_tokens ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
