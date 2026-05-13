ALTER TABLE jm_custom_ai_phases
  ADD COLUMN slots jsonb NOT NULL DEFAULT '[]'::jsonb;
