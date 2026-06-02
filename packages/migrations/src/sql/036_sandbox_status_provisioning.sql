-- Extend jm_sandbox_instances to support a transient 'provisioning' state.
-- The original CHECK allows only ('active','destroyed'); add 'provisioning'.
-- Also change the default so newly-claimed rows start as 'provisioning' rather
-- than jumping straight to 'active'.

ALTER TABLE jm_sandbox_instances
  DROP CONSTRAINT IF EXISTS jm_sandbox_instances_status_check;

ALTER TABLE jm_sandbox_instances
  ADD CONSTRAINT jm_sandbox_instances_status_check
    CHECK (status IN ('provisioning', 'active', 'destroyed'));

ALTER TABLE jm_sandbox_instances
  ALTER COLUMN status SET DEFAULT 'provisioning';
