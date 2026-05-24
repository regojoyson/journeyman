-- 025_rename_phases_to_steps.sql — rename "phase" terminology to "step" across schema.
-- Forward-only. No backwards compatibility.

BEGIN;

-- 1. Rename the custom AI phases table.
ALTER TABLE jm_custom_ai_phases RENAME TO jm_custom_ai_steps;

-- 2. Rename the unique constraint and index that embed the old name.
ALTER TABLE jm_custom_ai_steps
  RENAME CONSTRAINT jm_custom_ai_phases_scope_name_unique
  TO jm_custom_ai_steps_scope_name_unique;

ALTER INDEX IF EXISTS idx_jm_custom_ai_phases_org_user
  RENAME TO idx_jm_custom_ai_steps_org_user;

-- 3. Rewrite JSONB content in flow definition / instance snapshot / event payload rows.
--    Replace node-level keys phaseType → stepType, phaseId → stepId,
--    and the node-type discriminator "phase" → "step".

UPDATE jm_workflow_versions
SET definition = (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        definition::text,
        '"phaseType"', '"stepType"', 'g'
      ),
      '"phaseId"', '"stepId"', 'g'
    ),
    '"type"\s*:\s*"phase"', '"type":"step"', 'g'
  )
)::jsonb
WHERE definition::text ~ '"phaseType"|"phaseId"|"type"\s*:\s*"phase"';

UPDATE jm_workflow_instances
SET definition_snapshot = (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        definition_snapshot::text,
        '"phaseType"', '"stepType"', 'g'
      ),
      '"phaseId"', '"stepId"', 'g'
    ),
    '"type"\s*:\s*"phase"', '"type":"step"', 'g'
  )
)::jsonb
WHERE definition_snapshot IS NOT NULL
  AND definition_snapshot::text ~ '"phaseType"|"phaseId"|"type"\s*:\s*"phase"';

UPDATE jm_workflow_instance_events
SET payload = (
  regexp_replace(
    regexp_replace(
      payload::text,
      '"phaseType"', '"stepType"', 'g'
    ),
    '"phaseId"', '"stepId"', 'g'
  )
)::jsonb
WHERE payload::text ~ '"phaseType"|"phaseId"';

UPDATE jm_node_executions
SET input = (
  regexp_replace(
    regexp_replace(
      input::text,
      '"phaseType"', '"stepType"', 'g'
    ),
    '"phaseId"', '"stepId"', 'g'
  )
)::jsonb
WHERE input::text ~ '"phaseType"|"phaseId"';

UPDATE jm_node_executions
SET output = (
  regexp_replace(
    regexp_replace(
      output::text,
      '"phaseType"', '"stepType"', 'g'
    ),
    '"phaseId"', '"stepId"', 'g'
  )
)::jsonb
WHERE output IS NOT NULL
  AND output::text ~ '"phaseType"|"phaseId"';

-- 4. Rename event_type values: phase.* → step.*
UPDATE jm_workflow_instance_events
SET event_type = 'step.' || substring(event_type from 7)
WHERE event_type LIKE 'phase.%';

COMMIT;
