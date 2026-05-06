-- 014_custom_phase_default_tools.sql
-- Replace boolean needs_workspace with explicit canonical-tool list.

ALTER TABLE jm_custom_ai_phases
  ADD COLUMN default_tools JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Preserve behavior: needs_workspace=true was sugar for "enable bash".
UPDATE jm_custom_ai_phases
   SET default_tools = '["bash"]'::jsonb
 WHERE needs_workspace = true;

ALTER TABLE jm_custom_ai_phases
  DROP COLUMN needs_workspace;
