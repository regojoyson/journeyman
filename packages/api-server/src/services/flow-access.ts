import type { Flow, FlowGrant, FlowGrantRole, FlowScope } from "@journeyman/core";

export interface Caller {
  userId: string;
  orgId: string;
  role: "admin" | "member";
  isPlatformAdmin: boolean;
}

const ROLE_ORDER: Record<FlowGrantRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function effectiveRole(flow: Flow, caller: Caller): FlowGrantRole | null {
  if (caller.isPlatformAdmin) return "owner";
  const grants = flow.grants ?? [];
  let best: FlowGrantRole | null = null;
  for (const g of grants) {
    let match = false;
    let contributed: FlowGrantRole = g.role;
    if (g.principalType === "global") {
      match = true;
      contributed = "viewer"; // global grants give viewer to everyone; platform admins already returned 'owner' above
    } else if (g.principalType === "user" && g.principalId === caller.userId) {
      match = true;
    } else if (g.principalType === "org" && g.principalId === caller.orgId) {
      match = true;
    }
    if (match) {
      if (!best || ROLE_ORDER[contributed] > ROLE_ORDER[best]) best = contributed;
    }
  }
  // Org admin owns any flow with an org grant for their org (already covered above
  // if the grant exists). Org admin moderation read on user flows owned by org members
  // is enforced at the list query level, not here.
  if (caller.role === "admin") {
    const orgOwn = grants.find(g => g.principalType === "org" && g.principalId === caller.orgId);
    if (orgOwn) best = "owner";
  }
  return best;
}

export function canRead(flow: Flow, caller: Caller): boolean {
  return effectiveRole(flow, caller) !== null;
}
export function canEdit(flow: Flow, caller: Caller): boolean {
  const r = effectiveRole(flow, caller);
  return r === "editor" || r === "owner";
}
export function canDelete(flow: Flow, caller: Caller): boolean {
  return effectiveRole(flow, caller) === "owner";
}
export function canCreateAtScope(scope: FlowScope, caller: Caller): boolean {
  if (caller.isPlatformAdmin) return true;
  if (scope === "user") return true;
  if (scope === "org") return caller.role === "admin";
  if (scope === "global") return false; // only platform admin (handled above)
  return false;
}
export function canPromoteTo(target: "org" | "global", caller: Caller): boolean {
  if (target === "global") return caller.isPlatformAdmin;
  return caller.role === "admin" || caller.isPlatformAdmin;
}
