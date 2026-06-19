import type {
  WorkspaceRole,
  WorkspacePermission,
  WorkspaceMemberLike,
} from "./types/workspace.types.ts";

const OBSERVER: WorkspacePermission[] = ["workspace.view", "resource.read"];
const CONTRIBUTOR: WorkspacePermission[] = [...OBSERVER, "resource.write", "resource.delete"];
const MAINTAINER: WorkspacePermission[] = [...CONTRIBUTOR, "members.manage", "settings.manage"];

export const ROLE_GRANTS: Record<WorkspaceRole, WorkspacePermission[]> = {
  observer: OBSERVER,
  contributor: CONTRIBUTOR,
  maintainer: MAINTAINER,
};

export function roleGrants(role: WorkspaceRole): Set<WorkspacePermission> {
  return new Set(ROLE_GRANTS[role]);
}

/**
 * The ONLY function that changes when granular/custom permissions arrive later.
 * Phase 1: permissions derive purely from the member's role.
 */
export function resolvePermissions(member: WorkspaceMemberLike): Set<WorkspacePermission> {
  return roleGrants(member.role);
}

export interface CanInput {
  isPlatformAdmin: boolean;
  isOrgAdmin: boolean;
  member: WorkspaceMemberLike | null;
}

/** Pure access decision. STABLE — all guards bind to this shape. */
export function evaluateCan(input: CanInput, permission: WorkspacePermission): boolean {
  if (input.isPlatformAdmin) return true;
  if (input.isOrgAdmin) return true; // implicit maintainer on every workspace in the org
  if (input.member) return resolvePermissions(input.member).has(permission);
  return false;
}
