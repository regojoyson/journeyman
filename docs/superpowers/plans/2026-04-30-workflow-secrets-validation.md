# Workflow Secrets Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users author flows that declare per-step `requiredSecrets`, see only the secret names they can access, and get non-blocking warnings at save time when they reference inaccessible names. Run-time fail-fast already works.

**Architecture:** Three thin slices on top of the already-built `@journeyman/secrets` stack: (1) a `listVisibleNames` helper + read-only HTTP route, (2) a save-time warning attached to the flow create/update response, (3) a new "Required secrets" tab in the flow editor properties panel that fetches visible names and renders a combobox.

**Tech Stack:** TypeScript, Fastify, React, Postgres (existing), `@journeyman/secrets`, `@journeyman/core`.

**Per-user constraints:** No test files. No commits. No per-task typecheck steps.

**Spec:** `docs/superpowers/specs/2026-04-30-workflow-secrets-validation-design.md`

---

## File map

**New files:**
- `packages/secrets/src/visibility.ts` — `listVisibleNames(pool, ctx)` helper.
- `packages/secrets/src/routes/visible-names.ts` — `GET /api/orgs/:orgId/secrets/_visible-names` route.
- `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` — combobox UI for the new tab.
- `packages/flow-editor/src/api/secrets.ts` — fetch helper for visible names.

**Modified files:**
- `packages/secrets/src/index.ts` — re-export `listVisibleNames`.
- `packages/secrets/src/routes/index.ts` — register the new route.
- `packages/core/src/types/flow.types.ts` — add `FlowSaveWarning` discriminated-union type.
- `packages/api-server/src/routes/flows.ts` — compute `inaccessible_secrets` warning on `POST /flows` and `PUT /flows/:id`, attach to response.
- `packages/flow-editor/src/properties-panel/tabs-shell.tsx` — add `"requiredSecrets"` tab id + visibility entry.
- `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` — wire up the new tab.
- `docs/setup.md` — document the CLI-worker global-tier-only limitation.

---

## Task 1: `listVisibleNames` helper

**Files:**
- Create: `packages/secrets/src/visibility.ts`

- [ ] **Step 1: Create visibility.ts**

```ts
// packages/secrets/src/visibility.ts
import type { Pool } from "pg";
import type { RunContext } from "@journeyman/core";
import { listGlobalSecretNames } from "./global.ts";

/**
 * Returns the union of secret names visible to the caller in the given run context:
 *   - their own user-scope secrets in the active org
 *   - the active org's org-scope secrets
 *   - all global JM_GLOBAL_* names
 *
 * Names only — no values, no scope tags. Sorted, deduped.
 */
export async function listVisibleNames(pool: Pool, ctx: RunContext): Promise<string[]> {
  const r = await pool.query<{ name: string }>(
    `SELECT DISTINCT name FROM jm_secrets
      WHERE org_id = $1 AND (user_id = $2 OR user_id IS NULL)`,
    [ctx.org.id, ctx.user.id],
  );
  const set = new Set<string>();
  for (const row of r.rows) set.add(row.name);
  for (const g of listGlobalSecretNames()) set.add(g);
  return [...set].sort();
}
```

---

## Task 2: Re-export from `@journeyman/secrets`

**Files:**
- Modify: `packages/secrets/src/index.ts`

- [ ] **Step 1: Add the export line**

Append to the file:

```ts
export * from "./visibility.ts";
```

The full file becomes:

```ts
export * from "./crypto.ts";
export * from "./global.ts";
export * from "./resolver.ts";
export * from "./credential-store.ts";
export * from "./visibility.ts";
export { registerSecretsRoutes } from "./routes/index.ts";
```

---

## Task 3: HTTP route — visible names

**Files:**
- Create: `packages/secrets/src/routes/visible-names.ts`

- [ ] **Step 1: Create the route file**

```ts
// packages/secrets/src/routes/visible-names.ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listVisibleNames } from "../visibility.ts";

export async function registerVisibleNamesRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/secrets/_visible-names",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const ctx = req.runContext!;
      const { orgId } = req.params as { orgId: string };
      if (ctx.org.id !== orgId) {
        reply.code(403);
        return { error: "wrong_org" };
      }
      const names = await listVisibleNames(pool, ctx);
      return { names };
    },
  );
}
```

---

## Task 4: Register the new route

**Files:**
- Modify: `packages/secrets/src/routes/index.ts`

- [ ] **Step 1: Replace the file**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerOrgSecretRoutes } from "./org-secrets.ts";
import { registerUserSecretRoutes } from "./user-secrets.ts";
import { registerGlobalSecretRoutes } from "./global-secrets.ts";
import { registerResolveRoutes } from "./resolve.ts";
import { registerVisibleNamesRoutes } from "./visible-names.ts";

export async function registerSecretsRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgSecretRoutes(app, pool);
  await registerUserSecretRoutes(app, pool);
  await registerGlobalSecretRoutes(app, pool);
  await registerResolveRoutes(app, pool);
  await registerVisibleNamesRoutes(app, pool);
}
```

---

## Task 5: Add `FlowSaveWarning` type

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`

- [ ] **Step 1: Append the warning type**

Append at the end of the file (after the `FlowGraph` interface and any existing exports):

```ts
/**
 * Non-blocking warning returned alongside a successful flow save.
 * The save itself always succeeds when the body is well-formed.
 */
export type FlowSaveWarning =
  | {
      code: "inaccessible_secrets";
      message: string;
      names: string[];
    };
```

---

## Task 6: Save-time secrets warning in flow routes

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Add the helper at the top of the file**

Add immediately below the existing imports (after line 11):

```ts
import { listVisibleNames } from "@journeyman/secrets";
import type { FlowSaveWarning } from "@journeyman/core";

/**
 * Compute non-blocking warnings about inaccessible secret references in a flow definition.
 * Save proceeds regardless; warnings are attached to the response.
 */
async function computeSaveWarnings(
  c: Composition,
  ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>,
  definition: FlowGraph,
): Promise<FlowSaveWarning[]> {
  const needed = new Set<string>();
  for (const node of definition.nodes) {
    for (const name of node.requiredSecrets ?? []) needed.add(name);
  }
  if (needed.size === 0 || !c.pool) return [];
  const visible = new Set(await listVisibleNames(c.pool, ctx));
  const inaccessible = [...needed].filter(n => !visible.has(n)).sort();
  if (inaccessible.length === 0) return [];
  return [
    {
      code: "inaccessible_secrets",
      message:
        "Flow references secrets you cannot currently access. Runs will fail until they are created.",
      names: inaccessible,
    },
  ];
}
```

- [ ] **Step 2: Update `POST /flows` to attach warnings**

Replace the existing `POST /flows` handler block (currently lines ~119-153) with:

```ts
  app.post("/flows", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const caller = callerFromCtx(ctx);
    const body = createFlowBody.parse(req.body);

    if (!canCreateAtScope(body.scope as FlowScope, caller)) {
      reply.code(403); return { error: "forbidden" };
    }

    const orgId =
      body.scope === "user"   ? caller.orgId :
      body.scope === "org"    ? (body.orgId ?? caller.orgId) :
      /* global */              null;

    if (body.scope === "org" && orgId !== caller.orgId) {
      reply.code(403); return { error: "cannot_create_flow_in_other_org" };
    }

    const ownerUserId = body.scope === "user" ? caller.userId : null;

    const _v = validateAndWarnDefinition(body.definition as FlowGraph, reply);
    if (!_v.ok) return;

    const warnings = await computeSaveWarnings(c, ctx, body.definition as FlowGraph);

    const { flow, version } = await c.flows.create({
      scope: body.scope as FlowScope,
      name: body.name,
      description: body.description,
      orgId,
      ownerUserId,
      initialDefinition: body.definition as FlowGraph,
      createdByUserId: caller.userId,
    });
    reply.code(201);
    return warnings.length ? { flow, version, warnings } : { flow, version };
  });
```

- [ ] **Step 3: Update `PUT /flows/:id` to attach warnings**

Replace the existing `PUT /flows/:id` handler block (currently lines ~179-201) with:

```ts
  app.put("/flows/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);

    const flow = await c.flows.getById(id);
    if (!flow) { reply.code(404); return { error: "not_found" }; }
    if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.flows.updateMeta(id, { name: body.name, description: body.description });
    }
    let newVersion = null;
    let warnings: FlowSaveWarning[] = [];
    if (body.definition) {
      const _v = validateAndWarnDefinition(body.definition as FlowGraph, reply);
      if (!_v.ok) return;
      warnings = await computeSaveWarnings(c, ctx, body.definition as FlowGraph);
      newVersion = await c.flowVersions.appendVersion({
        flowId: id, definition: body.definition as FlowGraph, createdByUserId: caller.userId,
      });
    }
    const updated = await c.flows.getById(id);
    return warnings.length ? { flow: updated, version: newVersion, warnings } : { flow: updated, version: newVersion };
  });
```

> **Note for the implementer:** `c.pool` is the Postgres pool already exposed on the `Composition` object (`packages/api-server/src/composition.ts` already creates `pool` and uses it on line 117 to construct `SecretsCredentialStore`). If `Composition` doesn't expose `pool` as a public field, expose it the same way `runs` / `flows` / `events` are exposed — add `pool: dbPool` to the returned composition object. Do this once, here in this task, not in a separate task.

---

## Task 7: Visible-names fetch helper (editor side)

**Files:**
- Create: `packages/flow-editor/src/api/secrets.ts`

- [ ] **Step 1: Create the fetch helper**

```ts
// packages/flow-editor/src/api/secrets.ts

/**
 * Fetch the names of all secrets visible to the current caller in the given org.
 * Returns sorted, deduped names. Empty array if the request fails (UI shows
 * the empty-state hint in that case).
 */
export async function fetchVisibleSecretNames(orgId: string): Promise<string[]> {
  try {
    const r = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/secrets/_visible-names`, {
      credentials: "include",
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { names?: string[] };
    return Array.isArray(j.names) ? j.names : [];
  } catch {
    return [];
  }
}
```

> **If the editor already has an api/ folder with a fetcher convention** (axios/swr/etc.), use that instead of raw `fetch`. Keep the function signature the same.

---

## Task 8: Add `requiredSecrets` tab id

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/tabs-shell.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// packages/flow-editor/src/properties-panel/tabs-shell.tsx
import type { ReactNode } from "react";
import type { TabVisibility } from "../phase-definition.ts";

export type TabId = "config" | "mcp" | "credentials" | "requiredSecrets" | "retry" | "io";

export interface TabsVisibility {
  config?: TabVisibility; // always shown effectively; declared for symmetry
  io: TabVisibility;
  credentials: TabVisibility;
  requiredSecrets: TabVisibility;
  mcp: TabVisibility;
  retry: TabVisibility;
}

export interface TabRequiredFlags {
  io?: boolean;
  credentials?: boolean;
  requiredSecrets?: boolean;
  mcp?: boolean;
  retry?: boolean;
}

export interface TabShellProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  visibility: TabsVisibility;
  /** Per-tab "data is empty" flags — when a tab is `required` AND its flag is true, decorate with •. */
  requiredEmpty?: TabRequiredFlags;
  children: ReactNode;
}

const ALL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "config",          label: "Config"           },
  { id: "mcp",             label: "MCP & Tools"      },
  { id: "credentials",     label: "Credentials"      },
  { id: "requiredSecrets", label: "Required secrets" },
  { id: "retry",           label: "Retry"            },
  { id: "io",              label: "I/O"              },
];

function visibilityOf(id: TabId, v: TabsVisibility): TabVisibility {
  if (id === "config") return "shown";
  return v[id];
}

export function TabsShell({ active, onChange, visibility, requiredEmpty, children }: TabShellProps) {
  const visible = ALL_TABS.filter(t => visibilityOf(t.id, visibility) !== "hidden");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, fontSize: 11, marginBottom: 10, flexWrap: "wrap" }}>
        {visible.map(t => {
          const req = visibilityOf(t.id, visibility) === "required";
          const empty = req && t.id !== "config" && (requiredEmpty?.[t.id as Exclude<TabId, "config">] ?? false);
          return (
            <div
              key={t.id}
              onClick={() => onChange(t.id)}
              style={{
                padding: "6px 8px",
                borderBottom: t.id === active ? "2px solid #4a9eff" : "2px solid transparent",
                color: t.id === active ? "#4a9eff" : "#aaa",
                fontWeight: t.id === active ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {t.label}{empty ? " •" : ""}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
```

---

## Task 9: `RequiredSecretsTab` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx
import { useEffect, useState, useMemo } from "react";
import type { FlowNode } from "@journeyman/core";
import { fetchVisibleSecretNames } from "../api/secrets.ts";

export interface RequiredSecretsTabProps {
  node: FlowNode;
  orgId: string;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

function getRequired(node: FlowNode): string[] {
  return node.requiredSecrets ?? [];
}
function setRequired(node: FlowNode, next: string[]): FlowNode {
  return { ...node, requiredSecrets: next };
}

export function RequiredSecretsTab({ node, orgId, onChange, readOnly }: RequiredSecretsTabProps) {
  const required = getRequired(node);
  const [visible, setVisible] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchVisibleSecretNames(orgId).then(names => {
      if (!cancelled) { setVisible(names); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const visibleSet = useMemo(() => new Set(visible), [visible]);
  const remaining = useMemo(
    () => visible.filter(n => !required.includes(n)),
    [visible, required],
  );

  function add(name: string) {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) return;
    if (!NAME_RE.test(trimmed)) return;
    if (required.includes(trimmed)) return;
    onChange(setRequired(node, [...required, trimmed]));
    setDraft("");
  }
  function remove(name: string) {
    onChange(setRequired(node, required.filter(n => n !== name)));
  }

  return (
    <div>
      <div className="je-props__field">
        <label>Required secrets</label>
        <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>
          Names of env-vars this step needs at run time. Resolved as <code>user &gt; org &gt; global</code>.
        </div>

        {/* Selected chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {required.length === 0 && (
            <div style={{ color: "#666", fontSize: 11, fontStyle: "italic" }}>(none)</div>
          )}
          {required.map(name => {
            const accessible = visibleSet.has(name);
            return (
              <span
                key={name}
                title={accessible ? undefined : "Not accessible to you. Create it in My Secrets or ask an admin."}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  borderRadius: 3,
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace",
                  border: accessible ? "1px solid #444" : "1px solid #c08a3e",
                  background: accessible ? "#2a2a3e" : "#3a2e1a",
                  color: accessible ? "#ddd" : "#f0c97a",
                }}
              >
                {accessible ? "" : "⚠ "}{name}
                {!readOnly && (
                  <button
                    onClick={() => remove(name)}
                    style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", padding: 0, marginLeft: 2 }}
                    title="Remove"
                  >×</button>
                )}
              </span>
            );
          })}
        </div>

        {/* Combobox: pick from visible OR type a new name */}
        {!readOnly && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              list="je-required-secrets-options"
              type="text"
              value={draft}
              placeholder={loaded && visible.length === 0 ? "Type a name (e.g. GITHUB_TOKEN)" : "Pick or type a name"}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { add(draft); e.preventDefault(); } }}
              style={{ flex: 1, fontFamily: "ui-monospace, monospace" }}
            />
            <datalist id="je-required-secrets-options">
              {remaining.map(n => <option key={n} value={n} />)}
            </datalist>
            <button
              onClick={() => add(draft)}
              style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
            >
              + Add
            </button>
          </div>
        )}

        {loaded && visible.length === 0 && (
          <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>
            No secrets are currently accessible to you. Add one in <a href="/me/secrets">My Secrets</a> or ask an admin to add an org secret.
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Task 10: Wire `RequiredSecretsTab` into the properties panel

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Add import + prop + tab rendering**

Make four edits to the file:

**Edit A** — Add import below the existing tab imports (right after `import { IoTab } from "./IoTab.tsx";`):

```tsx
import { RequiredSecretsTab } from "./RequiredSecretsTab.tsx";
```

**Edit B** — Add `orgId` to `PropertiesPanelProps`:

```tsx
export interface PropertiesPanelProps {
  flow: FlowGraph;
  node: FlowNode | null;
  mcpCatalog: McpCatalog;
  orgId: string;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}
```

**Edit C** — Update `DEFAULT_VISIBILITY` and destructure `orgId`:

```tsx
const DEFAULT_VISIBILITY: TabsVisibility = {
  io:              "shown",
  credentials:     "shown",
  requiredSecrets: "shown",
  mcp:             "shown",
  retry:           "shown",
};

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { flow, node, mcpCatalog, orgId, onChange, readOnly } = props;
```

**Edit D** — Update `visibility` derivation, `requiredEmpty`, and the rendered tab content:

Replace the `visibility` and `requiredEmpty` blocks plus the `TabsShell` children with:

```tsx
  const visibility: TabsVisibility = definition
    ? {
        io: definition.tabs.io,
        credentials: definition.tabs.credentials,
        requiredSecrets: definition.tabs.requiredSecrets ?? "shown",
        mcp: definition.tabs.mcp,
        retry: definition.tabs.retry,
      }
    : DEFAULT_VISIBILITY;

  const requiredEmpty = {
    io: !((node as { inputs?: unknown[] }).inputs?.length || (node as { outputs?: unknown[] }).outputs?.length),
    credentials: !(node as { credentials?: unknown }).credentials,
    requiredSecrets: !(node.requiredSecrets?.length),
    mcp: !((node as { mcpTools?: unknown[] }).mcpTools?.length),
    retry: !node.retry,
  };

  const effectiveActive: TabId =
    active !== "config" && visibility[active] === "hidden" ? "config" : active;

  return (
    <aside className="je-editor__props">
      <div className="je-props__title">{node.displayName ?? node.type}</div>
      {isPhase ? (
        <TabsShell
          active={effectiveActive}
          onChange={setActive}
          visibility={visibility}
          requiredEmpty={requiredEmpty}
        >
          {effectiveActive === "config"          && <ConfigTab          flow={flow} node={node} onChange={onChange} readOnly={readOnly} mcpCatalog={mcpCatalog} />}
          {effectiveActive === "mcp"             && <McpToolsTab        node={node} catalog={mcpCatalog} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "credentials"     && <CredentialsTab     node={node} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "requiredSecrets" && <RequiredSecretsTab node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "retry"           && <RetryTab           node={node} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "io"              && <IoTab              flow={flow} node={node} onChange={onChange} readOnly={readOnly} />}
        </TabsShell>
      ) : node.type === "loop" || node.type === "timer" ? (
        <ControlNodeConfigTab flow={flow} node={node} onChange={onChange} readOnly={readOnly} />
      ) : node.type === "end" ? (
        <EndNodeConfig node={node} onChange={onChange} readOnly={readOnly} />
      ) : (
        <div className="je-empty">Control nodes have no per-tab config in v0.</div>
      )}
    </aside>
  );
}
```

> **Note for the implementer:** `definition.tabs.requiredSecrets` may not exist on every phase definition yet. The `?? "shown"` fallback handles that. If `phase-definition.ts` declares a strict tab-keys type, add `requiredSecrets?: TabVisibility` there too — same pattern as `credentials`.

---

## Task 11: Pass `orgId` to `PropertiesPanel` from its caller

**Files:**
- Modify: wherever `<PropertiesPanel ... />` is rendered. Find it via `grep -rn "PropertiesPanel" packages/flow-editor/src packages/web/src`.

- [ ] **Step 1: Locate the render site and pass `orgId`**

The caller already has the running user's org context (the same context that drives the rest of the editor's auth-bound data). Pass it through:

```tsx
<PropertiesPanel
  flow={flow}
  node={selectedNode}
  mcpCatalog={mcpCatalog}
  orgId={ctx.org.id}        // NEW
  onChange={handleChange}
  readOnly={readOnly}
/>
```

If the caller currently has no `orgId` in scope, source it from the same place `MySecretsPage` / `AdminSecretsPage` source theirs (the existing run-context / auth-context provider). Do not introduce a new context.

---

## Task 12: Extend `POST /flows/validate` with secret warnings

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

The existing `POST /flows/validate` endpoint (powering the editor's "Validate" button) returns a `FlowValidationReport` with `errors` / `missing` / `warnings` (string[]). Make it also return inaccessible-secrets warnings — the same structured `FlowSaveWarning[]` shape used by the save path — so the user sees the warning before saving.

- [ ] **Step 1: Extend the report type**

In `packages/api-server/src/routes/flows.ts`, replace the existing `FlowValidationReport` interface (currently lines ~13-18) with:

```ts
export interface FlowValidationReport {
  ok: boolean;
  errors: string[];                         // hard failures (graph structure, ref reachability)
  missing: string[];                        // required inputs without a typed value or binding
  warnings: string[];                       // refs to undeclared fields — non-blocking
  secretWarnings: FlowSaveWarning[];        // inaccessible secret references — non-blocking
}
```

- [ ] **Step 2: Drop `secretWarnings: []` into `computeValidationReport`'s return**

The existing `computeValidationReport(definition)` is purely synchronous and has no access to the pool / ctx. Keep it that way. Add an empty `secretWarnings: []` to its return so the type is satisfied:

In `computeValidationReport`, replace the final `return` line:

```ts
  return { ok: errors.length === 0 && missing.length === 0, errors, missing, warnings, secretWarnings: [] };
```

- [ ] **Step 3: Update the `/flows/validate` route to populate `secretWarnings`**

Replace the existing handler (currently at `app.post("/flows/validate", ...)`):

```ts
  app.post("/flows/validate", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!;
    const body = req.body as { definition?: FlowGraph };
    if (!body?.definition || typeof body.definition !== "object") {
      reply.code(400);
      return { error: "bad_request", message: "definition is required" };
    }
    const report = computeValidationReport(body.definition);
    const secretWarnings = await computeSaveWarnings(c, ctx, body.definition);
    return { ...report, secretWarnings };
  });
```

> **Implementer note:** the `ok` flag is unchanged — secret warnings are non-blocking, so they do *not* flip `ok` to false. The editor renders them as warnings (amber), not errors (red).

- [ ] **Step 4: Surface secret warnings in the editor's Validate result UI**

Find the component that renders the `/flows/validate` response (grep `flows/validate` in `packages/flow-editor/src` and `packages/web/src`). Wherever the existing `warnings` array is rendered, render `secretWarnings` immediately above or below with the same amber/warning treatment. Each `secretWarning` already carries a human-readable `message` and a `names` array — render the message and list the names as inline-code chips:

```tsx
{report.secretWarnings.map((w, i) => (
  <div key={i} className="je-validate__warning">
    <div>{w.message}</div>
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {w.names.map(n => (
        <code key={n} style={{ padding: "1px 4px", border: "1px solid #c08a3e", color: "#f0c97a", borderRadius: 3 }}>{n}</code>
      ))}
    </div>
  </div>
))}
```

If no validate-result component exists yet (i.e. the Validate button currently just shows `errors`/`missing`), add `secretWarnings` rendering alongside the existing handling — same place, same styling pattern.

---

## Task 13: Document CLI-worker limitation

**Files:**
- Modify: `docs/setup.md`

- [ ] **Step 1: Append a section**

Append at the bottom of `docs/setup.md`:

```markdown
## Secrets resolution: api-server vs cli-worker

Two execution paths resolve secrets differently:

- **api-server** (production / web-driven runs): uses `SecretsCredentialStore`,
  resolving in the order **user > org > global**. User-scope and org-scope
  secrets stored in Postgres are visible. Missing secrets fail the run with
  `reason: "missing_secrets"` before any phase executes.

- **cli-worker** (`packages/orchestrator/src/cli-worker.ts`): uses
  `EnvCredentialStore`. **Only the global tier is resolved** —
  `process.env.NAME` and `process.env.JM_GLOBAL_NAME`. User-scope and
  org-scope rows in the database are not visible to the CLI worker.

For local development against user/org secrets, run via api-server. The CLI
worker is intended for global-tier flows and quick smoke tests.
```

---

## Self-review

**Spec coverage:**

- §3 / §5.1 (`GET /api/orgs/:orgId/secrets/_visible-names`) → Task 3.
- §5.2 (`listVisibleNames` helper) → Task 1.
- §6 (non-blocking save warnings, response shape) → Task 6.
- §7.1–7.4 (combobox tab, chip warning state, eager re-fetch) → Tasks 7, 9, 10. Eager re-fetch is implicit: the tab fetches every time it mounts (its `useEffect` keys on `orgId`); navigating away and back re-runs it.
- §6.4 (validate-button surfaces same warnings) → Task 12.
- §8 (CLI-worker decision, doc only) → Task 13.
- §9 failure-modes table — all five rows are covered by existing run-time behavior plus the new save-warnings path; no new code beyond what's listed.

**Type consistency:**

- `FlowSaveWarning` defined in Task 5 is consumed in Task 6. Same `code: "inaccessible_secrets"` shape with `message` + `names`.
- `TabId` extended in Task 8 with `"requiredSecrets"`; consumed in Task 10's `effectiveActive === "requiredSecrets"` branch.
- `RequiredSecretsTabProps.orgId` (Task 9) matches the `orgId` prop added to `PropertiesPanelProps` in Task 10 and the call site in Task 11.
- `listVisibleNames(pool, ctx)` signature in Task 1 matches its call site in Task 6 (`computeSaveWarnings`) and Task 3 (route handler).

**Placeholder scan:** none — every file path and code block is concrete.

**Open implementation choices flagged in notes (not blockers):**

- Task 6 step 2 assumes `c.pool` is exposed on the `Composition` object. If it is not, expose it once in this task; do not split.
- Task 7 uses raw `fetch`. If the editor has an established api-client, switch to it without changing the function signature.
- Task 11 expects an existing org-context source. If somehow there isn't one, reuse the same hook/provider that `MySecretsPage` uses.
