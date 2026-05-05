# Skills Runtime Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Wire skills end-to-end so adding `skillPackageIds` to a phase node actually loads those skills into the run.

**Architecture:** Mirror MCP wiring exactly — `resolveSkillPackagesByIds` in the resolver, `listVisibleSkillPackages` in DB, a `skillsResolver` hook on `WorkerHarness`, and a `SkillsTab` in the flow editor. Three AI phase definitions flip `tabs.skills: "shown"` and `supportsSkills: true`.

**Tech Stack:** Postgres, Fastify, React, TypeScript.

**User overrides:** No commits. No unit tests. Final `npm run typecheck` only.

---

### Task 1: DB — `listVisibleSkillPackages` + by-id fetcher

**Files:**
- Modify: `packages/skills/src/db.ts`

- [ ] **Step 1: Add `VisibleSkillRow` interface and the helper at the bottom of the file**

```typescript
export interface VisibleSkillRow {
  id: string;
  name: string;
  scope: "user" | "org";
  installStatus: SkillInstallStatus;
  enabledSkillCount: number;
}

export async function listVisibleSkillPackages(
  pool: Pool,
  orgId: string,
  userId: string,
): Promise<VisibleSkillRow[]> {
  const { rows } = await pool.query(
    `SELECT id, name, user_id, install_status, enabled_skills
       FROM jm_skill_packages
      WHERE org_id = $1
        AND install_status = 'ready'
        AND (user_id = $2 OR user_id IS NULL)
      ORDER BY name`,
    [orgId, userId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    scope: r.user_id === null ? "org" : "user",
    installStatus: r.install_status,
    enabledSkillCount: (r.enabled_skills ?? []).length,
  }));
}

export async function fetchSkillPackagesByIds(
  pool: Pool,
  orgId: string,
  userId: string,
  ids: string[],
): Promise<SkillPackage[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT * FROM jm_skill_packages
      WHERE org_id = $1
        AND (user_id = $2 OR user_id IS NULL)
        AND id = ANY($3::uuid[])`,
    [orgId, userId, ids],
  );
  return rows.map(rowToPackage);
}
```

---

### Task 2: Resolver — `resolveSkillPackagesByIds` + missing error

**Files:**
- Modify: `packages/skills/src/resolver.ts`

- [ ] **Step 1: Add the `MissingSkillPackagesError` and the new function**

Replace the file contents with:

```typescript
import { existsSync } from "node:fs";
import type { Pool } from "pg";
import type { ResolvedSkillPackage } from "@journeyman/core";
import {
  fetchSkillPackagesByIds,
  listSkillPackagesForResolver,
  updateSkillPackageStatus,
} from "./db.ts";
import { clonePackage, refreshPackage } from "./installer.ts";

export class MissingSkillPackagesError extends Error {
  constructor(public missing: string[]) {
    super(`Skill packages not found: ${missing.join(", ")}`);
    this.name = "MissingSkillPackagesError";
  }
}

async function resolveOne(
  pool: Pool,
  pkg: { id: string; name: string; gitUrl: string; localPath?: string; enabledSkills: string[]; cliType: string },
): Promise<ResolvedSkillPackage | null> {
  try {
    const result =
      pkg.localPath && existsSync(pkg.localPath)
        ? refreshPackage(pkg.localPath, pkg.gitUrl)
        : clonePackage(pkg.name, pkg.gitUrl);

    await updateSkillPackageStatus(pool, pkg.id, {
      installStatus: "ready",
      localPath: result.localPath,
      commitSha: result.commitSha,
    });

    const enabledSkills =
      pkg.enabledSkills.length > 0
        ? pkg.enabledSkills.filter((s) => result.discoveredSkills.includes(s))
        : result.discoveredSkills;

    return {
      id: pkg.id,
      name: pkg.name,
      localPath: result.localPath,
      enabledSkills,
      cliType: pkg.cliType,
    };
  } catch (err) {
    await updateSkillPackageStatus(pool, pkg.id, {
      installStatus: "error",
      installError: String(err),
    }).catch(() => {});
    return null;
  }
}

export async function resolveSkillPackages(
  pool: Pool,
  orgId: string,
  userId: string,
  cliType: string,
): Promise<ResolvedSkillPackage[]> {
  const packages = await listSkillPackagesForResolver(pool, orgId, userId, cliType);
  const out: ResolvedSkillPackage[] = [];
  for (const pkg of packages) {
    const r = await resolveOne(pool, pkg);
    if (r) out.push(r);
  }
  return out;
}

export async function resolveSkillPackagesByIds(
  pool: Pool,
  ctx: { orgId: string; userId: string },
  packageIds: string[],
  cliType: string,
): Promise<ResolvedSkillPackage[]> {
  if (packageIds.length === 0) return [];
  const found = await fetchSkillPackagesByIds(pool, ctx.orgId, ctx.userId, packageIds);
  const byId = new Map(found.map((p) => [p.id, p]));
  const missing = packageIds.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new MissingSkillPackagesError(missing);

  const out: ResolvedSkillPackage[] = [];
  for (const pkg of found) {
    if (pkg.cliType !== cliType) continue;
    const r = await resolveOne(pool, pkg);
    if (r) out.push(r);
  }
  return out;
}
```

---

### Task 3: Barrel exports

**Files:**
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Export the new resolver function, error, and DB helpers**

```typescript
export {
  resolveSkillPackages,
  resolveSkillPackagesByIds,
  MissingSkillPackagesError,
} from "./resolver.ts";
```

(Replace the existing `export { resolveSkillPackages } from "./resolver.ts";` line.)

Also add to the db exports block:

```typescript
listVisibleSkillPackages,
fetchSkillPackagesByIds,
```

And add the type:

```typescript
export type { VisibleSkillRow } from "./db.ts";
```

---

### Task 4: Visible route

**Files:**
- Modify: `packages/skills/src/routes/org-skills.ts`

- [ ] **Step 1: Add `listVisibleSkillPackages` to the import block**

```typescript
import {
  ...,
  listVisibleSkillPackages,
} from "../db.ts";
```

- [ ] **Step 2: Add the visible route inside `registerOrgSkillRoutes` (before the closing `}`)**

```typescript
app.get(
  "/api/orgs/:orgId/skill-packages/visible",
  { preHandler: requireAuth() },
  async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return listVisibleSkillPackages(pool, orgId, ctx.user.id);
  },
);
```

---

### Task 5: Worker harness — `skillsResolver` hook

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Import `ResolvedSkillPackage`**

```typescript
import type {
  IEventBus, IPhaseRegistry, IWorkspaceProvider,
  SecretBinding,
  ResolvedMcpInstance,
  ResolvedSkillPackage,
} from "@journeyman/core";
```

- [ ] **Step 2: Add `skillsResolver` to `WorkerHarnessDeps`**

After the `mcpResolver` entry:

```typescript
/**
 * Resolves `skillPackageIds` (declared on a phase's node config) into
 * fully-formed `ResolvedSkillPackage[]` ready to hand to coding-cli.
 * Composition root supplies the implementation (curries the pg pool
 * over `resolveSkillPackagesByIds` from `@journeyman/skills`).
 */
skillsResolver: (input: {
  ctx: { userId: string; orgId: string };
  packageIds: string[];
}) => Promise<ResolvedSkillPackage[]>;
```

- [ ] **Step 3: Resolve skills in the run loop, mirroring MCP resolution**

Find the block that resolves `mcps` (after `mcpInstanceIds` is parsed). Immediately after that block (before the phase handler is invoked), add:

```typescript
const skillPackageIds = Array.isArray((phaseInput as { skillPackageIds?: unknown }).skillPackageIds)
  ? ((phaseInput as { skillPackageIds: unknown[] }).skillPackageIds.filter(
      (x): x is string => typeof x === "string"
    ))
  : [];
let skills: ResolvedSkillPackage[] = [];
if (skillPackageIds.length > 0 && userId && orgId) {
  try {
    skills = await this.deps.skillsResolver({
      ctx: { userId, orgId },
      packageIds: skillPackageIds,
    });
    log.info({ runId, nodeId, count: skills.length }, "skills resolved");
  } catch (err: any) {
    log.error({ runId, nodeId, err: err?.message }, "skills resolution failed");
    await this.deps.events.append({
      runId, nodeId, eventType: "phase.failed",
      payload: { reason: "skills_resolution_failed", message: String(err?.message ?? "") },
    });
    await this.deps.client.completeTask({
      workflowInstanceId: runId, taskId: task.taskId,
      status: "FAILED_WITH_TERMINAL_ERROR",
      reasonForIncompletion: `Skills resolution failed: ${err?.message ?? String(err)}`,
    });
    return;
  }
}
```

- [ ] **Step 4: Merge `skills` into the phase input**

Find where `mcps` is merged into the phase input (look for `mcps` being added to the input object) and add `skills` alongside. The phase handler receives the merged object, so `skills` propagates to `input.skills` exactly as `mcps` does.

If the merge currently looks like:
```typescript
const inputForHandler = { ...phaseInput, mcps };
```
update to:
```typescript
const inputForHandler = { ...phaseInput, mcps, skills };
```

(Adapt to actual variable names — the rule is "wherever `mcps` is added, add `skills` too".)

---

### Task 6: CLI worker wire-up

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Import `resolveSkillPackagesByIds`**

```typescript
import { resolveSkillPackagesByIds } from "@journeyman/skills";
```

- [ ] **Step 2: Inject `skillsResolver` into the `WorkerHarness` constructor**

In the `new WorkerHarness({ ... })` block, after the `mcpResolver:` entry, add:

```typescript
skillsResolver: ({ ctx, packageIds }) => {
  if (!pool) return Promise.resolve([]);
  return resolveSkillPackagesByIds(pool, ctx, packageIds, "claude");
},
```

---

### Task 7: Flow editor — `tabs-shell.tsx` adds Skills tab

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/tabs-shell.tsx`

- [ ] **Step 1: Add "skills" to `TabId`**

```typescript
export type TabId = "config" | "mcp" | "skills" | "requiredSecrets" | "retry" | "io";
```

- [ ] **Step 2: Add to `TabsVisibility`**

```typescript
export interface TabsVisibility {
  config?: TabVisibility;
  io: TabVisibility;
  requiredSecrets: TabVisibility;
  mcp: TabVisibility;
  skills: TabVisibility;
  retry: TabVisibility;
}
```

- [ ] **Step 3: Add to `TabRequiredFlags`**

```typescript
export interface TabRequiredFlags {
  io?: boolean;
  requiredSecrets?: boolean;
  mcp?: boolean;
  skills?: boolean;
  retry?: boolean;
}
```

- [ ] **Step 4: Add to `ALL_TABS`** (between mcp and requiredSecrets)

```typescript
const ALL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "config",          label: "Config"           },
  { id: "mcp",             label: "MCP & Tools"      },
  { id: "skills",          label: "Skills"           },
  { id: "requiredSecrets", label: "Required secrets" },
  { id: "retry",           label: "Retry"            },
  { id: "io",              label: "I/O"              },
];
```

---

### Task 8: SkillsTab.tsx

**Files:**
- Create: `packages/flow-editor/src/properties-panel/SkillsTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import type { FlowNode } from "@journeyman/core";

interface VisibleSkill {
  id: string;
  name: string;
  scope: "user" | "org";
  installStatus: "pending" | "installing" | "ready" | "error";
  enabledSkillCount: number;
}

export interface SkillsTabProps {
  node: FlowNode;
  orgId: string;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

function getSelectedIds(node: FlowNode): string[] {
  const cfg = (node.config ?? {}) as { skillPackageIds?: unknown };
  return Array.isArray(cfg.skillPackageIds)
    ? cfg.skillPackageIds.filter((x): x is string => typeof x === "string")
    : [];
}

function setSelectedIds(node: FlowNode, ids: string[]): FlowNode {
  return { ...node, config: { ...(node.config ?? {}), skillPackageIds: ids } };
}

export function SkillsTab({ node, orgId, onChange, readOnly }: SkillsTabProps) {
  const [available, setAvailable] = useState<VisibleSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = getSelectedIds(node);
  const enabledIds = new Set(selected);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/orgs/${orgId}/skill-packages/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleSkill[]) => {
        if (!alive) return;
        const sorted = [...rows].sort((a, b) =>
          a.scope === b.scope
            ? a.name.localeCompare(b.name)
            : a.scope === "org" ? -1 : 1
        );
        setAvailable(sorted);
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId]);

  const toggle = (id: string) => {
    if (readOnly) return;
    const next = enabledIds.has(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(setSelectedIds(node, next));
  };

  return (
    <div>
      <div className="je-props__field">
        <label>Skills</label>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
          Skill packages to load when this phase runs. Manage your skills at{" "}
          <a href="/me/skills" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/me/skills</a>{" "}
          or{" "}
          <a href="/admin/skills" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/admin/skills</a>.
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: "#888" }}>Loading…</div>
        ) : available.length === 0 ? (
          <div style={{ fontSize: 12, color: "#888" }}>
            No ready skill packages. Add some at{" "}
            <a href="/me/skills" target="_blank" rel="noreferrer" style={{ color: "#4a9eff" }}>/me/skills</a>.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {available.map((s) => {
              const checked = enabledIds.has(s.id);
              return (
                <label
                  key={s.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "#1f1f2c",
                    border: `1px solid ${checked ? "#4a9eff" : "#2a2a3a"}`,
                    borderRadius: 6,
                    padding: "6px 8px",
                    cursor: readOnly ? "not-allowed" : "pointer",
                    opacity: readOnly ? 0.6 : 1,
                  }}
                  title={`${s.enabledSkillCount} enabled skill${s.enabledSkillCount === 1 ? "" : "s"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => toggle(s.id)}
                  />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span style={{ fontSize: 10, color: "#888" }}>{s.scope}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### Task 9: PropertiesPanel — render the Skills tab

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Import SkillsTab**

```typescript
import { SkillsTab } from "./SkillsTab.tsx";
```

- [ ] **Step 2: Add to `DEFAULT_VISIBILITY`**

```typescript
const DEFAULT_VISIBILITY: TabsVisibility = {
  io:              "shown",
  requiredSecrets: "shown",
  mcp:             "shown",
  skills:          "hidden",
  retry:           "shown",
};
```

- [ ] **Step 3: Add `skills` to the `visibility` object built from `definition.tabs`**

```typescript
const visibility: TabsVisibility = definition
  ? {
      io: definition.tabs.io,
      requiredSecrets: definition.tabs.requiredSecrets ?? "shown",
      mcp: definition.tabs.mcp,
      skills: definition.tabs.skills ?? "hidden",
      retry: definition.tabs.retry,
    }
  : DEFAULT_VISIBILITY;
```

- [ ] **Step 4: Add to `requiredEmpty`**

```typescript
const requiredEmpty = {
  io: !((node as { inputs?: unknown[] }).inputs?.length || (node as { outputs?: unknown[] }).outputs?.length),
  requiredSecrets: !(node.secretBindings && Object.keys(node.secretBindings).length),
  mcp: !(((node.config as { mcpInstanceIds?: unknown[] } | undefined)?.mcpInstanceIds?.length ?? 0) > 0),
  skills: !(((node.config as { skillPackageIds?: unknown[] } | undefined)?.skillPackageIds?.length ?? 0) > 0),
  retry: !node.retry,
};
```

- [ ] **Step 5: Add the `effectiveActive === "skills"` branch in the `TabsShell` children**

Add this line after the `mcp` line:

```tsx
{effectiveActive === "skills"          && <SkillsTab          node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
```

---

### Task 10: Phase definitions — flip the flags

**Files:**
- Modify: `packages/phases/src/ai/analyze-repo.tsx`
- Modify: `packages/phases/src/ai/plan-implementation.tsx`
- Modify: `packages/phases/src/ai/implement-changes.tsx`

- [ ] **Step 1: In each file, add `skills: "shown"` to `tabs` and add `supportsSkills: true`**

For each of the three files, change the `tabs` line:
```typescript
tabs: { io: "shown", mcp: "shown", retry: "shown" },
```
to:
```typescript
tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
supportsSkills: true,
```

(`supportsSkills` is a sibling of `tabs`, not nested inside it.)

---

### Task 11: Web API client — `listVisible`

**Files:**
- Modify: `packages/web/src/api/skills.ts`

- [ ] **Step 1: Add the `VisibleSkillRow` type and `listVisible` function**

After the `PromotableSkillRow` interface, add:

```typescript
export interface VisibleSkillRow {
  id: string;
  name: string;
  scope: "user" | "org";
  installStatus: SkillInstallStatus;
  enabledSkillCount: number;
}
```

In the `skillsApi` object, add this method (placement: near `listOrg`):

```typescript
listVisible: (orgId: string) =>
  fetch(`/api/orgs/${orgId}/skill-packages/visible`, { credentials: "include" })
    .then(jsonOrThrow<VisibleSkillRow[]>),
```

---

### Task 12: Final typecheck

- [ ] **Step 1: Run `npm run typecheck`**

Run: `npm run typecheck`
Expected: zero errors. Fix anything that comes up before declaring complete.

---

## Self-Review

Spec coverage:
- listVisibleSkillPackages + fetchSkillPackagesByIds → Task 1 ✓
- resolveSkillPackagesByIds + MissingSkillPackagesError → Task 2 ✓
- Barrel exports → Task 3 ✓
- visible route → Task 4 ✓
- WorkerHarness skillsResolver hook + run-loop integration → Task 5 ✓
- CLI worker wire-up → Task 6 ✓
- TabsShell additions → Task 7 ✓
- SkillsTab component → Task 8 ✓
- PropertiesPanel rendering → Task 9 ✓
- Phase definition flags → Task 10 ✓
- Web API client → Task 11 ✓
- Final typecheck → Task 12 ✓

No placeholders. Type names are consistent across tasks. Plan is self-contained.
