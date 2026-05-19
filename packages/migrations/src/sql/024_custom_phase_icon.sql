-- 024: per-phase icon for custom AI phases.
-- NULL means "use the default icon" (resolved at render time).
ALTER TABLE jm_custom_ai_phases
  ADD COLUMN icon TEXT NULL;
