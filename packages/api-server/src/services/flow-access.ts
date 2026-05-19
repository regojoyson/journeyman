import type { Workflow, WorkflowGrant, WorkflowGrantRole, WorkflowScope } from "@journeyman/core";

export interface Caller {
  userId: string;
  orgId: string;
  role: "admin" | "member";
  isPlatformAdmin: boolean;
}

const ROLE_ORDER: Record<WorkflowGrantRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function effectiveRole(workflow: Workflow, caller: Caller): WorkflowGrantRole | null {
  if (caller.isPlatformAdmin) return "owner";
  const grants = workflow.grants ?? [];
  let best: WorkflowGrantRole | null = null;
  for (const g of grants) {
    let match = false;
    let contributed: WorkflowGrantRole = g.role;
    if (g.principalType === "global") {
      match = true;
      contributed = "viewer";
    } else if (g.principalType === "user" && g.principalId === caller.userId) {
      match = true;
    } else if (g.principalType === "org" && g.principalId === caller.orgId) {
      match = true;
    }
    if (match) {
      if (!best || ROLE_ORDER[contributed] > ROLE_ORDER[best]) best = contributed;
    }
  }
  if (caller.role === "admin") {
    const orgOwn = grants.find((g: WorkflowGrant) => g.principalType === "org" && g.principalId === caller.orgId);
    if (orgOwn) best = "owner";
  }
  return best;
}

export function canRead(workflow: Workflow, caller: Caller): boolean {
  return effectiveRole(workflow, caller) !== null;
}
export function canEdit(workflow: Workflow, caller: Caller): boolean {
  const r = effectiveRole(workflow, caller);
  return r === "editor" || r === "owner";
}
export function canDelete(workflow: Workflow, caller: Caller): boolean {
  return effectiveRole(workflow, caller) === "owner";
}
export function canCreateAtScope(scope: WorkflowScope, caller: Caller): boolean {
  if (caller.isPlatformAdmin) return true;
  if (scope === "user") return true;
  if (scope === "org") return caller.role === "admin";
  if (scope === "global") return false;
  return false;
}
export function canPromoteTo(target: "org" | "global", caller: Caller): boolean {
  if (target === "global") return caller.isPlatformAdmin;
  return caller.role === "admin" || caller.isPlatformAdmin;
}
