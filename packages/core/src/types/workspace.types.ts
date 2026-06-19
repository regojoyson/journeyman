/** Workspace-level role. Ordered maintainer > contributor > observer. */
export type WorkspaceRole = "maintainer" | "contributor" | "observer";

/**
 * Stable permission contracts. Routes bind to these names, never to roles.
 * Adding a permission here never breaks existing call sites.
 */
export const WORKSPACE_PERMISSIONS = [
  "workspace.view",
  "resource.read",
  "resource.write",
  "resource.delete",
  "members.manage",
  "settings.manage",
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export interface WorkspaceRecord {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceMemberRecord {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  /** Reserved future per-member permission override slot. Unused in Phase 1. */
  permissions: WorkspacePermission[] | null;
  createdAt: Date;
}

/** Minimal member shape needed to resolve permissions (decouples pure logic from the DB record). */
export interface WorkspaceMemberLike {
  role: WorkspaceRole;
  permissions?: WorkspacePermission[] | null;
}

/** Resolved workspace access attached to RunContext by requireWorkspacePermission. */
export interface WorkspaceContext {
  id: string;
  orgId: string;
  /** null when access is granted via platform/org admin without explicit membership. */
  role: WorkspaceRole | null;
  permissions: WorkspacePermission[];
}
