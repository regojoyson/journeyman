# Workspace Scoping — Phase 3: UI (Switcher + Page Consolidation) — Implementation Plan

> Three sub-phases, each its own commit. 3a is backend (one new route file). 3b is the client workspace context + sidebar switcher. 3c is page consolidation + route migration + wiring real `wsId` into the API clients. Execute 3a → 3b → 3c in order; each must typecheck clean before the next.

**Branch:** `feat/workspace-scoping-phase-2b` (continue here). **No new migration** — all tables exist.

**Scope (decided):** switcher + page consolidation + wire real `wsId`. **Deferred to a later phase:** org-admin workspace CRUD UI, and workspace member-management UI (add/remove members, set roles). The backend read route added in 3a is enough to drive the switcher and gate the UI; write routes for members/workspaces are NOT part of this plan.

**Why this phase exists:** after 2a–2j, every resource page in the web app is broken — they call dead `/me/*` and `/api/orgs/:orgId/...` endpoints, and `flows.ts`/`runs.ts` clients still hit `/api/workflows` (moved to `/api/workspaces/:wsId/workflows` in 2f). There is no way for the client to know which workspaces the user has or what they may do in them. 3a provides that; 3b consumes it; 3c repoints the pages.

---

## Phase 3a — Workspace-list + permissions API (backend)

The access token does NOT carry an active workspace (spec §6). The client needs one call that returns the caller's workspaces, each annotated with the caller's effective role and permission set, so the UI can populate the switcher and gate controls without a per-page authz round-trip.

### 1. DB helper `packages/identity/src/db-workspaces.ts`

Add a function that lists the workspaces a user can see in their active org:

```ts
/** Workspaces the user belongs to within an org (member rows joined to workspaces). */
export async function listWorkspacesForUser(
  db: Queryable, orgId: string, userId: string,
): Promise<Array<WorkspaceRecord & { role: WorkspaceRole }>> {
  const r = await db.query(
    `SELECT w.id, w.org_id, w.name, w.slug, w.created_at, wm.role
       FROM jm_workspaces w
       JOIN jm_workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
      WHERE w.org_id = $1
      ORDER BY w.name ASC`,
    [orgId, userId],
  );
  return r.rows.map((row) => ({
    id: row.id, orgId: row.org_id, name: row.name, slug: row.slug,
    createdAt: row.created_at, role: row.role as WorkspaceRole,
  }));
}
```

(Match the exact shape `WorkspaceRecord` declares in `@journeyman/core/types/workspace.types.ts` — read it first and map every field. If `WorkspaceRecord` has no `role`, the intersection type above is correct; do not add `role` to the core type.)

### 2. New route file `packages/identity/src/routes/workspaces.ts`

Follows the `orgs.ts` pattern (uses `makeRequireAuth` from `../middleware.ts`, takes `(app, pool)`).

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { WORKSPACE_PERMISSIONS, roleGrants, resolvePermissions } from "@journeyman/core";
import { makeRequireAuth } from "../middleware.ts";
import { listWorkspacesForUser, listWorkspacesForOrg } from "../db-workspaces.ts";

export async function registerWorkspaceRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  // List the caller's workspaces in their active org, annotated with effective
  // role + permissions. Org admins / platform admins see ALL org workspaces with
  // full (maintainer) permissions even without an explicit membership row.
  app.get("/api/workspaces", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    const orgId = ctx.org.id;
    const isAdmin = ctx.isPlatformAdmin || ctx.role === "admin";

    if (isAdmin) {
      const all = await listWorkspacesForOrg(pool, orgId);
      const perms = [...roleGrants("maintainer")];
      return {
        workspaces: all.map((w) => ({
          id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
          role: "maintainer" as const, permissions: perms,
        })),
      };
    }

    const mine = await listWorkspacesForUser(pool, orgId, ctx.user.id);
    return {
      workspaces: mine.map((w) => ({
        id: w.id, orgId: w.orgId, name: w.name, slug: w.slug,
        role: w.role,
        permissions: [...resolvePermissions({ role: w.role, permissions: null })],
      })),
    };
  });
}
```

Notes:
- `WORKSPACE_PERMISSIONS` import is only needed if you prefer it over `roleGrants("maintainer")` for the admin branch — `roleGrants("maintainer")` is the canonical full set; use it. Drop the `WORKSPACE_PERMISSIONS` import if unused.
- `resolvePermissions({ role, permissions: null })` mirrors how `authz.ts` builds the permission list for a member (roles-as-only-source today).

### 3. Register it `packages/identity/src/routes/index.ts`

- Import `registerWorkspaceRoutes` from `./workspaces.ts`.
- Add `await registerWorkspaceRoutes(app, pool);` in `registerIdentityRoutes` (after `registerOrgRoutes`).

### 4. Verify + commit (3a)

```
npm run typecheck
npm run check:boundaries
git add -A
git commit -m "feat(workspaces): GET /api/workspaces — caller's workspaces with effective role+permissions (phase 3a)"
```

Smoke test (optional, dev DB on :5433 must be migrated): `curl --cookie ... /api/workspaces` returns `{ workspaces: [{ id, name, slug, role, permissions }] }` with the bootstrap default workspace.

---

## Phase 3b — Client WorkspaceContext + sidebar switcher + restructure

### 1. API client `packages/web/src/api/workspaces.ts` (new)

```ts
import { api } from "./client.ts";
import type { WorkspacePermission, WorkspaceRole } from "@journeyman/core";

export interface WorkspaceSummary {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  permissions: WorkspacePermission[];
}

export function listMyWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }> {
  return api<{ workspaces: WorkspaceSummary[] }>("/api/workspaces");
}
```

### 2. `packages/web/src/WorkspaceContext.tsx` (new)

A context holding the workspace list, the active id (persisted), and a `can()` gate.

```ts
import { createContext, useContext } from "react";
import type { WorkspacePermission } from "@journeyman/core";
import type { WorkspaceSummary } from "./api/workspaces.ts";

export interface WorkspaceCtx {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;          // "" until resolved
  activeWorkspace: WorkspaceSummary | null;
  setActiveWorkspaceId: (id: string) => void;
  can: (perm: WorkspacePermission) => boolean;  // against active workspace
  loading: boolean;
}

export const WorkspaceContext = createContext<WorkspaceCtx>({
  workspaces: [], activeWorkspaceId: "", activeWorkspace: null,
  setActiveWorkspaceId: () => {}, can: () => false, loading: true,
});

export function useWorkspace(): WorkspaceCtx { return useContext(WorkspaceContext); }
```

### 3. `packages/web/src/WorkspaceProvider.tsx` (new)

Fetches `/api/workspaces` on mount, persists the active id to `localStorage["active-workspace-id"]`, resolves a default (persisted-if-still-present, else first), exposes `can()`.

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspacePermission } from "@journeyman/core";
import { WorkspaceContext } from "./WorkspaceContext.tsx";
import { listMyWorkspaces, type WorkspaceSummary } from "./api/workspaces.ts";

const LS_KEY = "active-workspace-id";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActive] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    listMyWorkspaces()
      .then(({ workspaces }) => {
        if (!alive) return;
        setWorkspaces(workspaces);
        const stored = localStorage.getItem(LS_KEY);
        const valid = stored && workspaces.some((w) => w.id === stored) ? stored : workspaces[0]?.id ?? "";
        setActive(valid);
      })
      .catch(() => { if (alive) setWorkspaces([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const setActiveWorkspaceId = useCallback((id: string) => {
    localStorage.setItem(LS_KEY, id);
    setActive(id);
  }, []);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  const can = useCallback(
    (perm: WorkspacePermission) => activeWorkspace?.permissions.includes(perm) ?? false,
    [activeWorkspace],
  );

  return (
    <WorkspaceContext.Provider
      value={{ workspaces, activeWorkspaceId, activeWorkspace, setActiveWorkspaceId, can, loading }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
```

Wrap the authed app with it: in `AuthGate.tsx`, the ready branch renders `{children}` inside `AuthContext.Provider`. Wrap that `{children}` with `<WorkspaceProvider>{children}</WorkspaceProvider>`. (Provider lives below auth so the fetch runs only when authenticated.)

### 4. Switcher `packages/web/src/components/WorkspaceSwitcher.tsx` (new)

A compact dropdown rendered at the top of the sidebar (above nav, below the brand). Uses `useWorkspace()` + `useNavigate()`. On select: `setActiveWorkspaceId(id)` then `navigate('/workspaces/' + id + '/workflows')`. Collapses to the workspace initial when the sidebar is collapsed (accept an `expanded` prop from Sidebar). If `workspaces.length <= 1`, render a static label (no dropdown). Match the existing sidebar inline-style aesthetic (CSS vars `--color-surface`, `--color-border`, etc.).

### 5. Sidebar restructure `packages/web/src/components/Sidebar.tsx`

Replace the static `NAV_ITEMS`/`ADMIN_ITEMS` model with workspace-relative + org/platform tiers. Pull `activeWorkspaceId`, `can`, and `activeWorkspace` from `useWorkspace()`; keep `role`/`isPlatformAdmin` from `useAuth()`.

- Render `<WorkspaceSwitcher expanded={expanded} />` at the top (after brand).
- **Workspace section** (only when `activeWorkspaceId`): build hrefs as `/workspaces/${activeWorkspaceId}/<resource>`. Items: Workflows, Workflow Instances, Secrets, Skills, MCPs, Custom Steps, Agents, Connections, Webhooks. Gate each by `can()`:
  - read-level items (everything listed) require `can("resource.read")` — Observer keeps read access, so all show.
  - (Members / Workspace Settings entries are deferred — do NOT add them this phase.)
- **Organization section** (`role === "admin" || isPlatformAdmin`): `Org Secrets` → `/orgs/:orgId/secrets`, `Org Sandboxes` → `/orgs/:orgId/sandboxes`, `Coding Models` → `/orgs/:orgId/coding-models`, `Members` → `/orgs/:orgId/members` (this is today's `AdminUsersPage`). Use `activeOrgId` from `useAuth()`.
- **Platform section** (`isPlatformAdmin`): leave a single `All Orgs` placeholder linking to an existing platform-admin page if one exists; otherwise omit (do not invent a page).
- Delete the `My X` profile-menu links that point to `/me/*` (replace `/me/secrets` etc. with the workspace equivalents, or drop them from the menu — keep only `Change password` + `Sign out`).

### 6. Verify + commit (3b)

```
npm run typecheck
npm run check:boundaries
git add -A
git commit -m "feat(web): workspace context + sidebar workspace switcher; restructure nav into workspace/org/platform tiers (phase 3b)"
```

At this point the switcher works but most resource links 404 in the router until 3c adds the routes. That is expected — 3b and 3c land back-to-back.

---

## Phase 3c — Page consolidation + route migration + wire real wsId

The largest sub-phase. Collapse each `My*`/`Admin*` pair into one workspace page, move routes, delete dead pages, and thread `wsId` through the flows/runs API clients.

### 1. Rewire `packages/web/src/api/flows.ts` and `runs.ts` to take `wsId`

These still call `/api/workflows` and `/api/workflow-instances` (moved to `/api/workspaces/:wsId/...` in 2f). Every exported function gains a leading `wsId: string` param and builds `\`/api/workspaces/${wsId}/workflows...\`` / `\`/api/workspaces/${wsId}/workflow-instances...\``. Update ALL call sites (FlowsListPage, FlowEditorPage, NewFlowPage, RunsListPage, RunDetailPage, RunFormPage, and any flow-versions/workflow-triggers clients that embed these paths). The SSE URL builders in `runs.ts` (events/export) also need `wsId`.

Check `packages/web/src/api/flow-versions.ts` and `workflow-triggers.ts` for `/api/workflows` or `/api/workflow-instances` prefixes and migrate them the same way.

### 2. Routes — `packages/web/src/App.tsx`

Replace the flat route table. New shape (workspace pages under a `:wsId` param; org pages under `:orgId`):

```
/  → redirect to /workspaces/:activeWorkspaceId/workflows (use a small redirect component that reads useWorkspace(); while loading, render null; if no workspaces, show an empty state)

/workspaces/:wsId/workflows                → FlowsListPage
/workspaces/:wsId/workflows/new            → NewFlowPage
/workspaces/:wsId/workflows/:id/edit       → FlowEditorPage
/workspaces/:wsId/workflows/:id/form       → RunFormPage
/workspaces/:wsId/workflow-instances       → RunsListPage
/workspaces/:wsId/workflow-instances/:id   → RunDetailPage
/workspaces/:wsId/secrets                  → SecretsPage tier="workspace"
/workspaces/:wsId/mcps                     → McpsPage
/workspaces/:wsId/skills                   → SkillsPage
/workspaces/:wsId/custom-steps             → CustomStepsPage
/workspaces/:wsId/agents                   → AgentsPage
/workspaces/:wsId/connections              → ConnectionsPage
/workspaces/:wsId/webhooks                 → WebhooksPage
/workspaces/:wsId/webhooks/:id             → WebhookDetailPage backTo={`/workspaces/${wsId}/webhooks`}

/orgs/:orgId/secrets        → SecretsPage tier="org"   (admin-gated)
/orgs/:orgId/sandboxes      → SandboxesPage             (admin-gated)
/orgs/:orgId/coding-models  → AdminCodingModelsPage     (admin-gated)
/orgs/:orgId/members        → AdminUsersPage            (admin-gated)
/forms                      → FormsInventoryPage        (unchanged)
```

Each page reads its id from `useParams()` (`wsId` or `orgId`) — **do not** pass `orgId={activeOrgId}` props anymore. Drop the `activeOrgId`/`role` prop-threading; admin gating stays as the `role === "admin" ? <Page/> : <Navigate to="/" replace/>` wrapper but the org id comes from the route param.

### 3. Consolidate pages (delete `My*`, keep one component each)

For each pair, keep ONE component that reads `useParams().wsId` and calls the already-workspace-scoped API client (`mcpApi.list(wsId)`, `skillsApi.list(wsId)`, `customStepsApi.list(wsId)`, `connectionsApi.list(wsId)`, agents/webhooks `list(wsId)`). Gate create/edit/delete behind `useWorkspace().can("resource.write")` / `can("resource.delete")` (Observer sees read-only).

| Keep (rename target) | Delete | Notes |
|---|---|---|
| `SecretsPage` (new, `tier: "workspace"\|"org"` prop) | `MySecretsPage`, `AdminSecretsPage` | workspace tier → `/api/workspaces/:wsId/secrets`; org tier → `/api/orgs/:orgId/secrets`. Build a single component; the two pages share ~90%. |
| `McpsPage` | `MyMcpsPage`, `AdminMcpsPage` | uses `mcpApi.list(wsId)`; modals already take `wsId` (from 2j). |
| `SkillsPage` | `MySkillsPage`, `AdminSkillsPage` | `skillsApi.list(wsId)`. |
| `CustomStepsPage` | `MyCustomStepsPage`, `AdminCustomStepsPage` | renders `CustomStepsList wsId={wsId}` (prop already migrated in 2j). |
| `AgentsPage` | `MyAgentsPage`, `AdminAgentsPage` | `agentsApi.list(wsId)`; `EditAgentModal` already takes `wsId`. |
| `WebhooksPage` | `MyWebhooksPage`, `AdminWebhooksPage` | `listWebhooks(wsId)`; `WebhookCreateWizard wsId={wsId}` (migrated in 2i). |
| `ConnectionsPage` (exists) | — | change signature from `{ wsId }` placeholder consumer to read `useParams().wsId`, OR keep the `wsId` prop and pass `useParams().wsId` from App. Pick the prop form for consistency with the others. |
| `FlowsListPage`, `RunsListPage`, `FlowEditorPage`, `RunDetailPage`, `NewFlowPage`, `RunFormPage` | — | read `wsId` from `useParams`; pass to the rewired flows/runs clients; replace the `// TODO(phase 3)` editability stubs with `can("resource.write")`. |
| `SandboxesPage` (exists) | — | already org-tier; route param `orgId` instead of prop. |
| `AdminUsersPage` | — | now reachable at `/orgs/:orgId/members`; reads `orgId` from params. |

**Deletes also remove:** the `/me/*` routes and the imports in `App.tsx`. Remove `MyWebhooksPage`'s former promote leftovers if any remain.

### 4. Replace remaining `wsId=""` placeholders

After routing reads real `wsId` from `useParams`, there should be no `wsId=""` left. Grep to confirm:
```
grep -rn 'wsId={""}\|wsId=""' packages/web/src   # must be empty after 3c
```

### 5. Fix the `// TODO(phase 3)` editability stubs

- `FlowsListPage.tsx`, `FlowEditorPage.tsx`: replace the hardcoded editability with `useWorkspace().can("resource.write")`.
- `RunDetailPage.tsx`: `const isViewer = !can("resource.write")`.
- `RunsListPage.tsx`, `AdminFlowsPage.tsx`: these filter by workspace already via the route `wsId`; drop the `isPlatformAdmin`/`void` TODO lines. `AdminFlowsPage` may be removed if `/admin/workflows` is dropped — verify it isn't linked from the new sidebar; if unlinked, delete it and its route.

### 6. Verify + commit (3c)

```
npm run typecheck
npm run check:boundaries
grep -rn 'wsId={""}\|/me/' packages/web/src        # confirm no dead /me routes or empty wsId remain
git add -A
git commit -m "feat(web): consolidate My*/Admin* pages into workspace pages; migrate routes to /workspaces/:wsId/* + /orgs/:orgId/*; wire real wsId (phase 3c)"
```

---

## Notes & decisions

- **Permission discovery without a workspace token (spec §6):** `GET /api/workspaces` returns each workspace with the caller's effective `role` + computed `permissions[]`. The client gates purely from this — no per-page authz call. Org/platform admins get all org workspaces with full (`maintainer`) permissions even without an explicit member row, matching `evaluateCan`.
- **`wsId` in the URL (not just context):** the spec (§9a/§9b) dictates `/workspaces/:wsId/<resource>`. URLs are shareable and the switcher just navigates. Pages read `useParams().wsId`, never the context's `activeWorkspaceId`, so a pasted URL works even before the switcher resolves. The switcher keeps context + URL in sync.
- **Switcher is client-only:** changing workspace is a client navigation + localStorage write; no token refresh, no server call beyond the resource fetches the destination page makes.
- **Deferred (NOT in this plan):** workspace create/delete UI, member add/remove/role UI, and their `POST/PATCH/DELETE /api/workspaces/:wsId/members` + `/api/orgs/:orgId/workspaces` routes. The `Members`/`Workspace Settings` sidebar entries are intentionally omitted until that phase. `db-workspaces.ts` already has the write helpers (`upsert/remove/updateWorkspaceMemberRole`, `createWorkspace`, `deleteWorkspace`) — wiring them to routes + UI is the next phase.
- **Secrets is one component, two routes:** `SecretsPage` with a `tier` prop reused at `/workspaces/:wsId/secrets` and `/orgs/:orgId/secrets`. Both tiers exist (§4); this is reuse, not duplication.
- **Gremlin guard:** no migration this phase, but after each commit verify a key new file is in HEAD (`git cat-file -e HEAD:packages/identity/src/routes/workspaces.ts` for 3a, etc.) per [[concurrent-worktree-activity]].
- **Implementation rhythm:** 3a and 3b are small (one strong-model pass each is fine). 3c is large and mechanical once the contracts are set — a Sonnet subagent can execute the page moves + client rewire, but the flows/runs client signature change touches many call sites; budget for a full typecheck-fix loop.
