ALTER TABLE jm_skill_packages
  DROP CONSTRAINT jm_skill_packages_scope_unique;

ALTER TABLE jm_skill_packages
  ADD CONSTRAINT jm_skill_packages_name_unique
  UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, name);
