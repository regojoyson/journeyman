import type {
  WorkspaceRecord,
  WorkspaceMemberRecord,
  WorkspaceRole,
} from "@journeyman/core";

/** Minimal query surface so unit tests can pass a fake (matches builder/src/db.ts). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

function rowToWorkspace(r: any): WorkspaceRecord {
  return {
    id: r.id,
    orgId: r.org_id,
    slug: r.slug,
    name: r.name,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

function rowToMember(r: any): WorkspaceMemberRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    role: r.role,
    permissions: r.permissions ?? null,
    createdAt: new Date(r.created_at),
  };
}

export async function createWorkspace(
  db: Queryable,
  input: { orgId: string; slug: string; name: string },
): Promise<WorkspaceRecord> {
  const r = await db.query(
    `INSERT INTO jm_workspaces (org_id, slug, name)
     VALUES ($1, $2, $3)
     RETURNING id, org_id, slug, name, created_at, updated_at`,
    [input.orgId, input.slug, input.name],
  );
  return rowToWorkspace(r.rows[0]);
}

export async function getWorkspace(db: Queryable, workspaceId: string): Promise<WorkspaceRecord | null> {
  const r = await db.query(
    `SELECT id, org_id, slug, name, created_at, updated_at
     FROM jm_workspaces WHERE id = $1`,
    [workspaceId],
  );
  return r.rows[0] ? rowToWorkspace(r.rows[0]) : null;
}

export async function listWorkspacesForOrg(db: Queryable, orgId: string): Promise<WorkspaceRecord[]> {
  const r = await db.query(
    `SELECT id, org_id, slug, name, created_at, updated_at
     FROM jm_workspaces WHERE org_id = $1 ORDER BY name ASC`,
    [orgId],
  );
  return r.rows.map(rowToWorkspace);
}

export async function deleteWorkspace(db: Queryable, workspaceId: string, orgId: string): Promise<void> {
  await db.query(`DELETE FROM jm_workspaces WHERE id = $1 AND org_id = $2`, [workspaceId, orgId]);
}

/** Workspaces the user belongs to within an org (member rows joined to workspaces). */
export async function listWorkspacesForUser(
  db: Queryable,
  orgId: string,
  userId: string,
): Promise<Array<WorkspaceRecord & { role: WorkspaceRole }>> {
  const r = await db.query(
    `SELECT w.id, w.org_id, w.slug, w.name, w.created_at, w.updated_at, wm.role
       FROM jm_workspaces w
       JOIN jm_workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
      WHERE w.org_id = $1
      ORDER BY w.name ASC`,
    [orgId, userId],
  );
  return r.rows.map((row) => ({ ...rowToWorkspace(row), role: row.role as WorkspaceRole }));
}

export async function upsertWorkspaceMember(
  db: Queryable,
  input: { workspaceId: string; userId: string; role: WorkspaceRole },
): Promise<WorkspaceMemberRecord> {
  const r = await db.query(
    `INSERT INTO jm_workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING id, workspace_id, user_id, role, permissions, created_at`,
    [input.workspaceId, input.userId, input.role],
  );
  return rowToMember(r.rows[0]);
}

export async function getWorkspaceMember(
  db: Queryable,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberRecord | null> {
  const r = await db.query(
    `SELECT id, workspace_id, user_id, role, permissions, created_at
     FROM jm_workspace_members WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  return r.rows[0] ? rowToMember(r.rows[0]) : null;
}

export async function listWorkspaceMembers(db: Queryable, workspaceId: string): Promise<WorkspaceMemberRecord[]> {
  const r = await db.query(
    `SELECT id, workspace_id, user_id, role, permissions, created_at
     FROM jm_workspace_members WHERE workspace_id = $1 ORDER BY created_at ASC`,
    [workspaceId],
  );
  return r.rows.map(rowToMember);
}

export async function removeWorkspaceMember(db: Queryable, workspaceId: string, userId: string): Promise<void> {
  await db.query(`DELETE FROM jm_workspace_members WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
}

export async function updateWorkspaceMemberRole(
  db: Queryable,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  await db.query(
    `UPDATE jm_workspace_members SET role = $3 WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId, role],
  );
}
