-- 047_workspaces.sql
-- Phase 1 of workspace scoping: add workspaces + per-workspace membership.
-- Backfills a "Default" workspace per existing org so the running system keeps working.

CREATE TABLE IF NOT EXISTS jm_workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS jm_workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES jm_users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('maintainer','contributor','observer')),
  permissions   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS jm_workspaces_org_idx ON jm_workspaces(org_id);
CREATE INDEX IF NOT EXISTS jm_workspace_members_ws_idx ON jm_workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS jm_workspace_members_user_idx ON jm_workspace_members(user_id);

-- Backfill: one "Default" workspace per org that has none.
INSERT INTO jm_workspaces (org_id, slug, name)
SELECT o.id, 'default', 'Default'
FROM jm_orgs o
WHERE NOT EXISTS (
  SELECT 1 FROM jm_workspaces w WHERE w.org_id = o.id AND w.slug = 'default'
);

-- Backfill: every existing org member becomes a workspace member of that org's default
-- workspace. Org admins -> maintainer, everyone else -> contributor.
INSERT INTO jm_workspace_members (workspace_id, user_id, role)
SELECT w.id, m.user_id,
       CASE WHEN m.role = 'admin' THEN 'maintainer' ELSE 'contributor' END
FROM jm_memberships m
JOIN jm_workspaces w ON w.org_id = m.org_id AND w.slug = 'default'
WHERE NOT EXISTS (
  SELECT 1 FROM jm_workspace_members wm
  WHERE wm.workspace_id = w.id AND wm.user_id = m.user_id
);
