import type { RunContext } from "./types/identity.types.ts";

/**
 * Org-scope access check for org-scoped routes (`/api/orgs/:orgId/...`).
 *
 * A caller may act on `orgId` when it matches their session org, OR when they
 * are a platform admin — superadmins span all orgs/workspaces. This mirrors the
 * platform-admin exemption already present in `makeRequireOrgRole` (identity
 * authz) and `evaluateCan` (workspace-permissions); it exists so the inline
 * `ctx.org.id !== orgId` checks scattered across route handlers cannot drift
 * out of sync with that policy again.
 */
export function canAccessOrg(ctx: RunContext, orgId: string): boolean {
  return ctx.isPlatformAdmin || ctx.org.id === orgId;
}
