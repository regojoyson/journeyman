import type { ActorContext, RunGrantRole } from "../types/run-grants.types.ts";

export interface GrantLike {
  principalType: "user" | "org" | "global";
  principalId: string | null;
  role: RunGrantRole;
}

const RANK: Record<RunGrantRole, number> = { viewer: 1, editor: 2, owner: 3 };

/**
 * Compute the highest effective role for an actor across a list of grants
 * attached to a single subject (a flow or a run).
 *
 *  - Platform admins always get "owner".
 *  - Otherwise: pick the highest-ranked matching grant.
 *  - Org admins are elevated to "owner" on any matching ('org', theirOrgId, *) grant.
 *  - Returns null if no grant matches.
 */
export function effectiveRole(
  actor: ActorContext,
  grants: GrantLike[],
): RunGrantRole | null {
  if (actor.isPlatformAdmin) return "owner";

  let best: RunGrantRole | null = null;
  for (const g of grants) {
    let matched: RunGrantRole | null = null;

    if (g.principalType === "global") {
      matched = g.role;
    } else if (g.principalType === "user" && actor.userId && g.principalId === actor.userId) {
      matched = g.role;
    } else if (g.principalType === "org" && actor.orgId && g.principalId === actor.orgId) {
      // Org admin elevation: any matching org grant becomes "owner" for org admins.
      matched = actor.role === "admin" ? "owner" : g.role;
    }

    if (matched && (!best || RANK[matched] > RANK[best])) best = matched;
  }
  return best;
}

export function hasAtLeast(
  role: RunGrantRole | null,
  required: RunGrantRole,
): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[required];
}
