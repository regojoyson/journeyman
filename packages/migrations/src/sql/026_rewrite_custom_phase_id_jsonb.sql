-- 026_rewrite_custom_phase_id_jsonb.sql — finish the phase→step rename for
-- the customPhaseId config key on custom-ai nodes. Missed in 025.

BEGIN;

UPDATE jm_workflow_versions
SET definition = regexp_replace(definition::text, '"customPhaseId"', '"customStepId"', 'g')::jsonb
WHERE definition::text LIKE '%"customPhaseId"%';

UPDATE jm_workflow_instances
SET definition_snapshot = regexp_replace(definition_snapshot::text, '"customPhaseId"', '"customStepId"', 'g')::jsonb
WHERE definition_snapshot IS NOT NULL
  AND definition_snapshot::text LIKE '%"customPhaseId"%';

UPDATE jm_workflow_instance_events
SET payload = regexp_replace(payload::text, '"customPhaseId"', '"customStepId"', 'g')::jsonb
WHERE payload::text LIKE '%"customPhaseId"%';

UPDATE jm_node_executions
SET input = regexp_replace(input::text, '"customPhaseId"', '"customStepId"', 'g')::jsonb
WHERE input::text LIKE '%"customPhaseId"%';

UPDATE jm_node_executions
SET output = regexp_replace(output::text, '"customPhaseId"', '"customStepId"', 'g')::jsonb
WHERE output IS NOT NULL
  AND output::text LIKE '%"customPhaseId"%';

COMMIT;
