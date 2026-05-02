-- 007_issue_ref.sql
-- Rename ticketKey → issueRef in jm_runs inputs JSONB
UPDATE jm_runs
SET inputs = inputs - 'ticketKey' || jsonb_build_object('issueRef', inputs->>'ticketKey')
WHERE inputs ? 'ticketKey';

-- Rename ticketId → issueRef (create-workspace runs)
UPDATE jm_runs
SET inputs = inputs - 'ticketId' || jsonb_build_object('issueRef', inputs->>'ticketId')
WHERE inputs ? 'ticketId';

-- Rename ticketShortKey → issueRefShort
UPDATE jm_runs
SET inputs = inputs - 'ticketShortKey' || jsonb_build_object('issueRefShort', inputs->>'ticketShortKey')
WHERE inputs ? 'ticketShortKey';
