-- 008_webhook_events.sql

CREATE TABLE IF NOT EXISTS jm_webhook_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider        TEXT        NOT NULL,
  event_type      TEXT,
  delivery_id     TEXT,
  issue_ref       TEXT,
  product_id      TEXT,
  raw_headers     JSONB,
  raw_payload     JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'received',
  error           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS jm_webhook_events_delivery_idx
  ON jm_webhook_events (provider, delivery_id)
  WHERE delivery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jm_webhook_events_issue_ref_idx   ON jm_webhook_events (issue_ref);
CREATE INDEX IF NOT EXISTS jm_webhook_events_received_at_idx ON jm_webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS jm_webhook_events_product_idx     ON jm_webhook_events (product_id);
CREATE INDEX IF NOT EXISTS jm_webhook_events_status_idx      ON jm_webhook_events (status);

ALTER TABLE jm_runs
  ADD COLUMN IF NOT EXISTS webhook_event_id UUID REFERENCES jm_webhook_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jm_runs_webhook_event_idx ON jm_runs (webhook_event_id);
