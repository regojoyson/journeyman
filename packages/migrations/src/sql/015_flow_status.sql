-- 015_flow_status.sql
-- Add lifecycle status to jm_flows. New flows default to 'draft'.
-- Existing rows are backfilled to 'draft' so authors must validate and
-- publish before the flow runs again.

ALTER TABLE jm_flows
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'ready'));
