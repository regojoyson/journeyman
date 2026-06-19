# Workspace Scoping — Phase 2j: Cleanup — Implementation Plan

> Executed by a cheaper model: follow literally. Hard contracts specified; no design decisions. STOP and report if a typecheck error can't be fixed with a minimal edit per this plan.

**Goal:** Close all workspace-scoping deferred stubs:
1. Fix `builder-chat.ts` inventory (skills/MCP/custom-steps/webhooks all return empty — broken).
2. Fix `webhook-trigger-fire.ts` `startedByOrgId: null` (wrong org context for webhook-triggered runs).
3. Collapse web API clients (`mcp.ts`, `skills.ts`, `customSteps.ts`) from old user/org-scope paths to workspace paths.
4. Drop `scope` props from MCP/Skills/Custom-steps page components; pass `wsId=""` placeholder.
5. Delete dead promote dialogs (`PromoteMcpDialog`, `PromoteSkillDialog`) and stale web API functions.

**Branch:** `feat/workspace-scoping-phase-2b`. **No new migration** (all DB changes are done). **Requires 2i to be merged first** (builder-chat inventory calls `c.webhooks.listByWorkspace`).

**Batched workflow:** all edits → one `npm run typecheck` + `check:boundaries` → one commit.

---

## Edits

### 1. `packages/api-server/src/routes/builder-chat.ts` — Fix inventory

Replace `loadInventory` to resolve the default workspace and call workspace-scoped DB functions:

```ts
import { listCustomAiSteps } from "@journeyman/custom-steps";
import { listMcpInstances } from "@journeyman/mcp";
import { listSkillPackages } from "@journeyman/skills";
// Remove: PostgresWebhookStore (no longer needed here)

async function resolveDefaultWorkspaceId(pool: import("pg").Pool, orgId: string): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    "SELECT id FROM jm_workspaces WHERE org_id = $1 AND slug = 'default' LIMIT 1",
    [orgId],
  );
  return res.rows[0]?.id ?? null;
}

async function loadInventory(c: Composition, orgId: string): Promise<InventorySummary> {
  const pool = c.pool!;
  const sandboxes = await listVisibleSandboxes(pool, orgId);
  const workspaceId = await resolveDefaultWorkspaceId(pool, orgId);
  const [skills, mcps, customSteps, webhooks] = workspaceId
    ? await Promise.all([
        listSkillPackages(pool, workspaceId),
        listMcpInstances(pool, workspaceId),
        listCustomAiSteps(pool, workspaceId),
        c.webhooks.listByWorkspace(workspaceId),
      ])
    : [[], [], [], []];
  return {
    customSteps: customSteps.map((s) => ({ id: s.id, name: s.name, description: s.description ?? "" })),
    mcps: mcps.map((m) => ({ id: m.id, name: m.name })),
    skills: skills.map((s) => ({ id: s.id, name: s.name })),
    sandboxes: sandboxes.map((s) => ({ id: s.id, name: s.name, type: s.type, tags: s.tags })),
    webhooks: webhooks.map((w) => ({ id: w.id, name: w.name ?? w.id, preset: w.preset })),
  };
}
```

Also: update the call site `loadInventory(c, orgId, ctx.user.id)` → `loadInventory(c, orgId)` (drop `userId` arg).

Remove the `PostgresWebhookStore` import (no longer used in this file).

### 2. `packages/api-server/src/services/webhook-trigger-fire.ts` — Fix `startedByOrgId`

At line ~99, replace `startedByOrgId: null, // TODO`:

```ts
// Before:
startedByOrgId: null, // TODO(workspace cutover): resolve org from workspace

// After — inline lookup; pool is available via c.
const wsRow = await (c as any).pool?.query<{ org_id: string }>(
  "SELECT org_id FROM jm_workspaces WHERE id = $1",
  [workflow.workspaceId],
);
// ... inside the submit call:
startedByOrgId: wsRow?.rows[0]?.org_id ?? null,
```

**Cleaner approach** — add a small helper above the submit block:
```ts
async function resolveOrgId(c: Composition, workspaceId: string): Promise<string | null> {
  if (!c.pool) return null;
  const r = await c.pool.query<{ org_id: string }>(
    "SELECT org_id FROM jm_workspaces WHERE id = $1",
    [workspaceId],
  );
  return r.rows[0]?.org_id ?? null;
}
```

Then at the submit call:
```ts
startedByOrgId: await resolveOrgId(c, workflow.workspaceId),
```

Note: `c.pool` is available — `Composition` declares it as `pool?: Pool`. Add `import type { Pool } from "pg"` if not already present. The null guard is already in place via `?? null`.

### 3. `packages/web/src/api/mcp.ts` — Collapse to workspace paths

Rewrite completely. Keep: `McpTransport`, `McpBinding`, `McpInstance`, `CatalogEntry`, `UpsertBody`, `ToolSummary`, `TestOutcome` interfaces. Drop: `PromotableRow`, `userBase`, `orgBase`, `listMy`, `listOrg`, `listPromotable`, `createMy`, `createOrg`, `updateMy`, `updateOrg`, `removeMy`, `removeOrg`, `promote`, `testMy`, `testOrg` functions.

New `mcpApi` shape:
```ts
const wsBase = (wsId: string) => `/api/workspaces/${wsId}/mcp-instances`;

export const mcpApi = {
  list:   (wsId: string) => fetch(wsBase(wsId), { credentials: "include" }).then(jsonOrThrow<McpInstance[]>),
  create: (wsId: string, body: UpsertBody) =>
    fetch(wsBase(wsId), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow<McpInstance>),
  update: (wsId: string, id: string, body: UpsertBody) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow<McpInstance>),
  remove: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<void>),
  test:   (wsId: string, id: string, body: { tool: string; args: Record<string, unknown> }) =>
    fetch(`${wsBase(wsId)}/${id}/test`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow<TestOutcome>),
  listCatalog: () => fetch("/api/mcp-catalog", { credentials: "include" }).then(jsonOrThrow<CatalogEntry[]>),
};
```

### 4. `packages/web/src/api/skills.ts` — Collapse to workspace paths

Drop local `SkillPackage`, `VisibleSkillRow`, `PromotableRow` interfaces. The pages only need what the server returns. Keep `SkillCatalogEntry`, `SkillInstallStatus`, `SkillCliType`, `CreateSkillBody`.

New `skillsApi` shape — all routes under `/api/workspaces/:wsId/skill-packages`:
```ts
const wsBase = (wsId: string) => `/api/workspaces/${wsId}/skill-packages`;

// Use @journeyman/core SkillPackage type if exported, otherwise inline.
export interface SkillPackageRow {
  id: string;
  workspaceId: string;
  orgId: string;
  gitUrl: string;
  name: string;
  localPath?: string;
  commitSha?: string;
  installStatus: SkillInstallStatus;
  installError?: string;
  enabledSkills: string[];
  cliType: SkillCliType;
  createdAt: string;
  updatedAt: string;
}

export const skillsApi = {
  list:    (wsId: string) => fetch(wsBase(wsId), { credentials: "include" }).then(jsonOrThrow<SkillPackageRow[]>),
  catalog: () => fetch("/api/skill-catalog", { credentials: "include" }).then(jsonOrThrow<SkillCatalogEntry[]>),
  create:  (wsId: string, body: CreateSkillBody) =>
    fetch(wsBase(wsId), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow<SkillPackageRow>),
  remove:  (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),
  updateEnabledSkills: (wsId: string, id: string, enabledSkills: string[]) =>
    fetch(`${wsBase(wsId)}/${id}/enabled-skills`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabledSkills }) })
      .then(jsonOrThrow<{ ok: true }>),
  discoverSkills: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/skills`, { credentials: "include" }).then(jsonOrThrow<string[]>),
  findByUrl: async (wsId: string, gitUrl: string): Promise<SkillPackageRow | null> => {
    const r = await fetch(`${wsBase(wsId)}/by-url?url=${encodeURIComponent(gitUrl)}`, { credentials: "include" });
    if (r.status === 404) return null;
    return jsonOrThrow<SkillPackageRow>(r);
  },
  pull:    (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/pull`, { method: "POST", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),
};
```

Drop: `listMy`, `listOrg`, `listVisible`, `listPromotable`, `createMy`, `createOrg`, `removeMy`, `removeOrg`, `promote`, `findByUrlMy`, `findByUrlOrg`, `updateEnabledSkillsMy`, `updateEnabledSkillsOrg`, `discoverSkillsMy`, `discoverSkillsOrg`, `pullMy`, `pullOrg`.

### 5. `packages/web/src/api/customSteps.ts` — Collapse to workspace paths

Drop `userBase`, `orgBase`, `listMine`, `listOrg`, `listVisible`, `createMine`, `promoteToOrg`. All routes under `/api/workspaces/:wsId/custom-steps`:

```ts
const wsBase = (wsId: string) => `/api/workspaces/${wsId}/custom-steps`;

export const customStepsApi = {
  list:    (wsId: string) => fetch(wsBase(wsId), { credentials: "include" }).then(jsonOrThrow<CustomAiStep[]>),
  create:  (wsId: string, body: CustomAiStepCreateInput) =>
    fetch(wsBase(wsId), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow<CustomAiStep>),
  update:  (wsId: string, id: string, body: CustomAiStepUpdateInput) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow<CustomAiStep>),
  remove:  (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<void>),
  get:     (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { credentials: "include" }).then(jsonOrThrow<CustomAiStep>),
  exportOne: async (wsId: string, id: string) => {
    const r = await fetch(`${wsBase(wsId)}/${id}/export`, { credentials: "include" });
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error((b as any)?.error ?? `HTTP ${r.status}`); }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") ?? "";
    const m = /filename="([^"]+)"/.exec(cd);
    const filename = m?.[1] ?? "custom-step.json";
    const a = document.createElement("a"); const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(objectUrl);
  },
  importOne: (wsId: string, body: unknown) =>
    fetch(`${wsBase(wsId)}/import`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(jsonOrThrow<CustomAiStep>),
};
```

### 6. `packages/web/src/api/flow-grants.ts` — Remove dead promote function

`promoteFlow` calls `/api/workflows/:id/promote` — this route was removed in Phase 2f. Delete the `promoteFlow` export. Keep `cloneFlow` (POST `/api/workflows/:id/clone` — verify this route still exists; if not, remove it too) and `deleteFlow` (DELETE `/api/workflows/:id` — also verify).

**Check first:** `grep -n "clone\|DELETE /api/workflows" packages/api-server/src/routes/flows.ts` — if `/clone` is gone, remove `cloneFlow` too and fix `FlowsListPage`/`FlowEditorPage` callers (replace with a stub or remove the UI action).

Remove the `promoteFlow` import from `FlowsListPage.tsx` and `AdminFlowsPage.tsx`. Replace any `promoteFlow(...)` call sites with a `// TODO(phase 3): re-expose promote via workspace copy UI` comment or remove the button entirely.

### 7. Web page components — Drop `scope` prop; pass `wsId`

**MCP pages:**
- `packages/web/src/routes/MyMcpsPage.tsx`: Replace `mcpApi.listMy(orgId)` → `mcpApi.list("")`; drop `scope="user"` from modal props → `wsId={""}`.
- `packages/web/src/routes/AdminMcpsPage.tsx`: Replace `mcpApi.listOrg(orgId)` + `mcpApi.listPromotable(orgId)` → `mcpApi.list("")`; drop the "Promotable MCPs" table section entirely; drop `scope="org"` from modal props → `wsId={""}`.
- `packages/web/src/components/mcp/AddFromCatalogModal.tsx`: Replace `scope: "user" | "org"` prop with `wsId: string`; call `mcpApi.create(wsId, body)` unconditionally (drop the `scope === "user"` branch).
- `packages/web/src/components/mcp/AddCustomModal.tsx`: Same as above.
- `packages/web/src/components/mcp/EditMcpModal.tsx`: Replace `scope` prop with `wsId`; call `mcpApi.update(wsId, id, body)` and `mcpApi.remove(wsId, id)` unconditionally.
- `packages/web/src/components/mcp/TestMcpModal.tsx`: Replace `scope` prop with `wsId`; call `mcpApi.test(wsId, id, body)`.
- `packages/web/src/components/mcp/PromoteMcpDialog.tsx`: **DELETE** (promote concept is gone).
  - Remove its import from `AdminMcpsPage.tsx`.
- `packages/web/src/components/mcp/SecretPicker.tsx`: The local `scope` field on `VisibleSecret` from secrets API is separate from workspace scoping — leave unchanged.

**Skills pages:**
- `packages/web/src/routes/MySkillsPage.tsx`: Replace `skillsApi.listMy(orgId)` → `skillsApi.list("")`; drop `scope="user"` from `AddFromCatalogModal`/`AddCustomModal` → `wsId={""}`.
- `packages/web/src/routes/AdminSkillsPage.tsx`: Replace `skillsApi.listOrg(orgId)` + `skillsApi.listPromotable(orgId)` → `skillsApi.list("")`; drop the "Promotable Skills" / `PromotableRow` section; drop `scope="org"` from modals → `wsId={""}`.
- `packages/web/src/components/skills/PromoteSkillDialog.tsx`: **DELETE** (promote concept is gone). Remove its import from `AdminSkillsPage.tsx`.
- Skill modals `AddFromCatalogModal` / `AddCustomModal` for skills (if separate from MCP ones — check): drop `scope`, take `wsId`, call `skillsApi.create(wsId, body)` unconditionally.

**Custom steps pages:**
- `packages/web/src/routes/MyCustomStepsPage.tsx`: Update to pass `wsId={""}` to `CustomStepsList`.
- `packages/web/src/routes/AdminCustomStepsPage.tsx`: Same.
- The `CustomStepsList` component: Find it (`packages/web/src/components/custom-steps/CustomStepsList.tsx` or similar), replace `scope: "user" | "org"` prop with `wsId: string`; call `customStepsApi.list(wsId)`, `customStepsApi.create(wsId, body)`, etc. unconditionally. Drop all `scope === "user"` branching.

### 8. Verify + commit

```
npm run typecheck            # clean across all workspaces
npm run check:boundaries
git checkout feat/workspace-scoping-phase-2b
git add -A
git commit -m "feat(cleanup): Phase 2j — fix builder inventory, webhook orgId, collapse web API clients to workspace paths; delete promote dialogs"
git cat-file -e HEAD:packages/api-server/src/routes/builder-chat.ts && echo "builder-chat in HEAD ✓"
```

---

## Notes

- **No migration**: all DB changes are already done (2b-2i). This phase is purely code cleanup.
- **Requires 2i**: `builder-chat.ts` calls `c.webhooks.listByWorkspace(workspaceId)` — this method only exists after Phase 2i lands. Implement 2i before 2j.
- **`wsId=""` placeholders**: Web pages pass `wsId=""` to components — this is intentional. Phase 3 (sidebar workspace switcher) will replace the empty string with the active workspace from auth context. All API calls with `wsId=""` will 404 gracefully.
- **SecretPicker `scope` field**: The `scope` in `SecretPicker.tsx` is from the secrets API response (`VisibleSecret["scope"]`), which is `"workspace" | "org" | "global"` — this is the secret tier, NOT workspace-scoping, and must NOT be changed.
- **`update-flow.ts` schema `scope: z.enum(["workspace", "org"])`**: This is the secret binding scope in the flow editor — workspace and org secret tiers — NOT a webhook/agent scope. Leave it unchanged.
- **`startedByOrgId` in the rest of the system**: It remains `string | null` throughout (orchestrator, worker-harness, etc.) — that is correct and doesn't need changing. Only the webhook trigger fire path was passing `null` when the org was knowable.
- **`flow-grants.ts` `cloneFlow`**: Verify the clone route still exists (`POST /api/workflows/:id/clone`) before deciding to keep or remove it.
