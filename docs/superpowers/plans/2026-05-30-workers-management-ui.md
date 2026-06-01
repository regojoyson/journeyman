# Workers Management UI Implementation Plan (Plan 3-UI of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the **Workers management UI** (My/Org Workers pages with create/edit/delete) and the **flow-editor worker pickers** (flow-level `defaults.workerId` + per-node `workerId` override), consuming the Plan 3 backend API.

**Architecture:** Mirror the existing MCP management UI (`packages/web/src/routes/MyMcpsPage.tsx` + `components/mcp/*` + `api/mcp.ts`) for the management pages, and the flow-editor patterns (`FlowConfigPanel` + `Defaults*Section` for flow-level; `McpToolsTab`'s fetch-`/visible` pattern for the node panel). A shared `WorkerFormModal` handles create+edit; a shared `WorkersPage` is parameterized by scope. Pickers are dropdowns populated from `GET /api/orgs/:orgId/workers/visible`.

**Tech Stack:** React 18 + TypeScript + Tailwind utility classes (`admin-styles.ts`). **No UI test runner exists** — verification is `tsc --noEmit` per package + a manual preview checklist.

**Depends on:** Plan 3 (Workers REST API + `defaults.workerId` / `WorkflowNode.workerId` in core).

**Scope note (v1 form):** the create/edit form supports the two built worker types — **`local`** (`baseDir`, `retainWorkspace`) and **`docker`** (connection local/remote, image ref/Dockerfile, network full/none). `executionMode`/`connectivity` are derived from type (local→`shared`/none; docker→`per-instance`/`push`). Resources/env/mounts/tags and other worker types are deferred to a later UI iteration (noted inline).

---

## File Structure (Plan 3-UI)

- `packages/web/src/api/workers.ts` — **Create.** Worker types + `workersApi` fetch wrappers.
- `packages/web/src/components/workers/WorkerFormModal.tsx` — **Create.** Create+edit modal with type-conditional config.
- `packages/web/src/routes/WorkersPage.tsx` — **Create.** Shared list page (scope-parameterized) used by both routes.
- `packages/web/src/App.tsx` — **Modify.** Add `/me/workers` + `/admin/workers` routes.
- `packages/web/src/components/Sidebar.tsx` — **Modify.** Add nav items.
- `packages/flow-editor/src/flow-config/DefaultsWorkerSection.tsx` — **Create.** Flow-level worker dropdown bound to `defaults.workerId`.
- `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx` — **Modify.** Thread `orgId`, render the section.
- `packages/flow-editor/src/properties-panel/WorkerTab.tsx` — **Create.** Per-node worker override dropdown bound to `node.workerId` + workspace caveat.
- The node properties panel host — **Modify.** Mount `WorkerTab` (thread `orgId`, already available to the panel).

---

## Task 1: Workers API client

**Files:**
- Create: `packages/web/src/api/workers.ts`

- [ ] **Step 1: Create the API client**

Create `packages/web/src/api/workers.ts`:

```ts
export type WorkerType =
  | "local" | "docker" | "machine-linux" | "machine-windows" | "ecs" | "ec2" | "kubernetes" | "cloud";
export type ExecutionMode = "per-instance" | "shared";
export type Connectivity = "push" | "agent";
export type WorkerScope = "user" | "org" | "system";

export interface Worker {
  id: string;
  scope: WorkerScope;
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity: Connectivity | null;
  config: Record<string, unknown>;
  isDefault: boolean;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkerUpsertBody {
  name: string;
  type: WorkerType;
  executionMode: ExecutionMode;
  connectivity?: Connectivity | null;
  config?: Record<string, unknown>;
  isDefault?: boolean;
  tags?: string[];
  enabled?: boolean;
}

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/workers`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/workers`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error((body as { error?: string })?.error ?? `HTTP ${r.status}`);
}

const postJson = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const patchJson = (url: string, body: unknown) =>
  fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const workersApi = {
  listVisible: (orgId: string) =>
    fetch(`${orgBase(orgId)}/visible`, { credentials: "include" }).then(jsonOrThrow<Worker[]>),

  listMy: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<Worker[]>),
  createMy: (orgId: string, body: WorkerUpsertBody) =>
    postJson(userBase(orgId), body).then(jsonOrThrow<Worker>),
  updateMy: (orgId: string, id: string, body: Partial<WorkerUpsertBody>) =>
    patchJson(`${userBase(orgId)}/${id}`, body).then(jsonOrThrow<{ ok: true }>),
  removeMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<Worker[]>),
  createOrg: (orgId: string, body: WorkerUpsertBody) =>
    postJson(orgBase(orgId), body).then(jsonOrThrow<Worker>),
  updateOrg: (orgId: string, id: string, body: Partial<WorkerUpsertBody>) =>
    patchJson(`${orgBase(orgId)}/${id}`, body).then(jsonOrThrow<{ ok: true }>),
  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<{ ok: true }>),
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 2: Worker create/edit modal

**Files:**
- Create: `packages/web/src/components/workers/WorkerFormModal.tsx`

- [ ] **Step 1: Create the modal**

Create `packages/web/src/components/workers/WorkerFormModal.tsx`:

```tsx
import { useState } from "react";
import { btnGhost, btnPrimary, card, inputCls, selectCls } from "../../routes/admin-styles.ts";
import { workersApi, type Worker, type WorkerType, type WorkerUpsertBody } from "../../api/workers.ts";

export interface WorkerFormModalProps {
  orgId: string;
  scope: "user" | "org";
  /** Present ⇒ edit; absent ⇒ create. */
  worker?: Worker;
  onClose: () => void;
  onSaved: () => void;
}

type ConnKind = "local" | "remote";
type ImageKind = "ref" | "dockerfile";

function readDockerConfig(cfg: Record<string, unknown>) {
  const connection = (cfg.connection ?? { kind: "local" }) as { kind?: ConnKind; host?: string };
  const image = (cfg.image ?? { kind: "ref", imageRef: "" }) as
    { kind?: ImageKind; imageRef?: string; content?: string };
  return {
    connKind: (connection.kind ?? "local") as ConnKind,
    host: connection.host ?? "",
    imageKind: (image.kind ?? "ref") as ImageKind,
    imageRef: image.imageRef ?? "",
    dockerfile: image.content ?? "",
    network: (cfg.network ?? "full") as "full" | "none",
  };
}

export function WorkerFormModal(props: WorkerFormModalProps) {
  const editing = Boolean(props.worker);
  const [name, setName] = useState(props.worker?.name ?? "");
  const [type, setType] = useState<WorkerType>(props.worker?.type ?? "local");
  const [isDefault, setIsDefault] = useState(props.worker?.isDefault ?? false);

  // local config
  const [baseDir, setBaseDir] = useState(String((props.worker?.config?.baseDir as string) ?? ""));
  const [retainWorkspace, setRetainWorkspace] = useState(Boolean(props.worker?.config?.retainWorkspace));

  // docker config
  const d = readDockerConfig(props.worker?.config ?? {});
  const [connKind, setConnKind] = useState<ConnKind>(d.connKind);
  const [host, setHost] = useState(d.host);
  const [imageKind, setImageKind] = useState<ImageKind>(d.imageKind);
  const [imageRef, setImageRef] = useState(d.imageRef);
  const [dockerfile, setDockerfile] = useState(d.dockerfile);
  const [network, setNetwork] = useState<"full" | "none">(d.network);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildConfig(): Record<string, unknown> {
    if (type === "local") {
      return { ...(baseDir ? { baseDir } : {}), ...(retainWorkspace ? { retainWorkspace: true } : {}) };
    }
    // docker
    return {
      connection: connKind === "remote" ? { kind: "remote", host } : { kind: "local" },
      image: imageKind === "ref" ? { kind: "ref", imageRef } : { kind: "dockerfile", content: dockerfile },
      network,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: WorkerUpsertBody = {
      name,
      type,
      executionMode: type === "docker" ? "per-instance" : "shared",
      connectivity: type === "docker" ? "push" : null,
      config: buildConfig(),
      isDefault,
    };
    try {
      if (editing) {
        const patch: Partial<WorkerUpsertBody> = {
          name: body.name, executionMode: body.executionMode, connectivity: body.connectivity,
          config: body.config, isDefault: body.isDefault,
        };
        if (props.scope === "user") await workersApi.updateMy(props.orgId, props.worker!.id, patch);
        else await workersApi.updateOrg(props.orgId, props.worker!.id, patch);
      } else if (props.scope === "user") {
        await workersApi.createMy(props.orgId, body);
      } else {
        await workersApi.createOrg(props.orgId, body);
      }
      props.onSaved();
      props.onClose();
    } catch (e2) {
      setError((e2 as Error)?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">{editing ? "Edit worker" : "New worker"}</h2>
        <form onSubmit={submit} className="space-y-4">
          <input className={inputCls} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />

          <label className="block text-sm text-slate-300">
            Type
            <select className={`${selectCls} block mt-1`} value={type}
              disabled={editing} onChange={(e) => setType(e.target.value as WorkerType)}>
              <option value="local">Local (no isolation)</option>
              <option value="docker">Docker (per-instance)</option>
            </select>
          </label>

          {type === "local" && (
            <>
              <input className={inputCls} placeholder="Base folder (optional)" value={baseDir}
                onChange={(e) => setBaseDir(e.target.value)} />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={retainWorkspace} onChange={(e) => setRetainWorkspace(e.target.checked)} />
                Keep workspace folder after the run
              </label>
            </>
          )}

          {type === "docker" && (
            <>
              <label className="block text-sm text-slate-300">
                Connection
                <select className={`${selectCls} block mt-1`} value={connKind}
                  onChange={(e) => setConnKind(e.target.value as ConnKind)}>
                  <option value="local">Local socket</option>
                  <option value="remote">Remote daemon</option>
                </select>
              </label>
              {connKind === "remote" && (
                <input className={inputCls} placeholder="tcp://host:2376" value={host}
                  onChange={(e) => setHost(e.target.value)} />
              )}

              <label className="block text-sm text-slate-300">
                Image
                <select className={`${selectCls} block mt-1`} value={imageKind}
                  onChange={(e) => setImageKind(e.target.value as ImageKind)}>
                  <option value="ref">Prebuilt image ref</option>
                  <option value="dockerfile">Dockerfile</option>
                </select>
              </label>
              {imageKind === "ref" ? (
                <input className={inputCls} placeholder="myorg/jm-runner:java21" value={imageRef}
                  onChange={(e) => setImageRef(e.target.value)} />
              ) : (
                <textarea className={inputCls} rows={6} placeholder="FROM ..." value={dockerfile}
                  onChange={(e) => setDockerfile(e.target.value)} />
              )}

              <label className="block text-sm text-slate-300">
                Network
                <select className={`${selectCls} block mt-1`} value={network}
                  onChange={(e) => setNetwork(e.target.value as "full" | "none")}>
                  <option value="full">Full (internet)</option>
                  <option value="none">None (offline)</option>
                </select>
              </label>
            </>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Set as default worker
          </label>

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 3: Workers management page (shared, scope-parameterized)

**Files:**
- Create: `packages/web/src/routes/WorkersPage.tsx`

- [ ] **Step 1: Create the page**

Create `packages/web/src/routes/WorkersPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { workersApi, type Worker } from "../api/workers.ts";
import { WorkerFormModal } from "../components/workers/WorkerFormModal.tsx";

export function WorkersPage(props: { orgId: string; scope: "user" | "org" }) {
  const [rows, setRows] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(props.scope === "user" ? await workersApi.listMy(props.orgId) : await workersApi.listOrg(props.orgId));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [props.orgId, props.scope]);

  async function remove(row: Worker) {
    if (!confirm(`Delete worker "${row.name}"?`)) return;
    if (props.scope === "user") await workersApi.removeMy(props.orgId, row.id);
    else await workersApi.removeOrg(props.orgId, row.id);
    refresh();
  }

  const title = props.scope === "user" ? "My Workers" : "Org Workers";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
            <p className="mt-1 text-sm text-slate-400">Compute targets your workflows can run on.</p>
          </div>
          <button onClick={() => setCreating(true)} className={btnPrimary}>+ New worker</button>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Workers <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No workers yet. Use "New worker" above.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Type</th>
                  <th className="text-left font-medium px-6 py-3">Mode</th>
                  <th className="text-left font-medium px-6 py-3">Default</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.type}</td>
                    <td className="px-6 py-3 text-slate-300">{r.executionMode}</td>
                    <td className="px-6 py-3 text-slate-300">{r.isDefault ? "★" : <span className="text-slate-600">—</span>}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditing(r)} className={btnGhost}>Edit</button>
                        <button onClick={() => remove(r)} className={btnDanger}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {creating && (
        <WorkerFormModal orgId={props.orgId} scope={props.scope} onClose={() => setCreating(false)} onSaved={refresh} />
      )}
      {editing && (
        <WorkerFormModal orgId={props.orgId} scope={props.scope} worker={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 4: Router + sidebar entries

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Import the page in `App.tsx`**

Add near the other route-page imports in `packages/web/src/App.tsx`:

```tsx
import { WorkersPage } from "./routes/WorkersPage.tsx";
```

- [ ] **Step 2: Add the routes**

In `packages/web/src/App.tsx`, next to the `/me/mcps` and `/admin/mcps` routes, add:

```tsx
<Route path="/me/workers" element={<WorkersPage orgId={activeOrgId} scope="user" />} />
<Route path="/admin/workers" element={role === "admin" ? <WorkersPage orgId={activeOrgId} scope="org" /> : <Navigate to="/" replace />} />
```

- [ ] **Step 3: Add sidebar nav items**

In `packages/web/src/components/Sidebar.tsx`, add to `NAV_ITEMS` (after the `/me/mcps` entry):

```ts
  { to: "/me/workers", icon: "👷", label: "My Workers" },
```

and to `ADMIN_ITEMS` (after the `/admin/mcps` entry):

```ts
  { to: "/admin/workers", icon: "👷", label: "Org Workers" },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 5: Flow-level worker picker

**Files:**
- Create: `packages/flow-editor/src/flow-config/DefaultsWorkerSection.tsx`
- Modify: `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx`

- [ ] **Step 1: Create the section**

Create `packages/flow-editor/src/flow-config/DefaultsWorkerSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { WorkflowDefaults } from "@journeyman/core";

interface VisibleWorker {
  id: string;
  name: string;
  type: string;
  executionMode: string;
  scope: string;
  enabled: boolean;
}

interface Props {
  orgId: string;
  defaults: WorkflowDefaults;
  onChange: (next: WorkflowDefaults) => void;
  readOnly?: boolean;
}

export function DefaultsWorkerSection({ orgId, defaults, onChange, readOnly }: Props) {
  const [workers, setWorkers] = useState<VisibleWorker[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/orgs/${orgId}/workers/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleWorker[]) => { if (alive) setWorkers(rows.filter((w) => w.enabled)); })
      .catch(() => { if (alive) setWorkers([]); });
    return () => { alive = false; };
  }, [orgId]);

  const setWorkerId = (workerId: string | undefined) => onChange({ ...defaults, workerId });

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
      <div style={{ color: "#ccc", fontSize: 12, marginBottom: 6 }}>Worker (where this workflow runs)</div>
      <select
        value={defaults.workerId ?? ""}
        disabled={readOnly}
        onChange={(e) => setWorkerId(e.target.value || undefined)}
        style={{ width: "100%", padding: "4px", borderRadius: "4px" }}
      >
        <option value="">Default (system Local Workspace)</option>
        {workers.map((w) => (
          <option key={w.id} value={w.id}>{w.name} ({w.type} · {w.executionMode})</option>
        ))}
      </select>
      <div className="je-props__field-help" style={{ marginTop: 4 }}>
        Steps that don't override use this worker. Leave as Default to run in-process.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it in `FlowConfigPanel` (thread `orgId`)**

In `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx`:

(a) Add `orgId` to the props interface:

```tsx
export interface FlowConfigPanelProps {
  flow: WorkflowGraph;
  orgId: string;
  onChange: (next: WorkflowGraph) => void;
  onClose: () => void;
  readOnly?: boolean;
}
```

(b) Destructure `orgId` and import + render the section after `DefaultsModelSection`:

```tsx
import { DefaultsWorkerSection } from "./DefaultsWorkerSection.tsx";
// ...
export function FlowConfigPanel({ flow, orgId, onChange, onClose, readOnly }: FlowConfigPanelProps) {
  // ...existing...
  // after <DefaultsModelSection ... /> :
  <DefaultsWorkerSection orgId={orgId} defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
```

(c) **Thread `orgId` from the caller.** Find where `<FlowConfigPanel` is rendered (search `packages/flow-editor` and `packages/web` for `FlowConfigPanel`). The flow editor already receives `orgId` for the MCP tab (see `McpToolsTab` usage); pass the same `orgId` prop here. If the editor root lacks `orgId`, thread it down from `FlowEditorPage` (which has `activeOrgId`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS. (If it fails because a `FlowConfigPanel` caller doesn't pass `orgId`, fix that caller — that's the threading in Step 2c.)

---

## Task 6: Per-node worker override

**Files:**
- Create: `packages/flow-editor/src/properties-panel/WorkerTab.tsx`
- Modify: the node properties panel host that renders the per-node tabs.

- [ ] **Step 1: Create the per-node worker field**

Create `packages/flow-editor/src/properties-panel/WorkerTab.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";

interface VisibleWorker {
  id: string;
  name: string;
  type: string;
  executionMode: string;
  enabled: boolean;
}

export interface WorkerTabProps {
  orgId: string;
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

export function WorkerTab({ orgId, node, onChange, readOnly }: WorkerTabProps) {
  const [workers, setWorkers] = useState<VisibleWorker[]>([]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/orgs/${orgId}/workers/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleWorker[]) => { if (alive) setWorkers(rows.filter((w) => w.enabled)); })
      .catch(() => { if (alive) setWorkers([]); });
    return () => { alive = false; };
  }, [orgId]);

  const overridden = Boolean(node.workerId);
  const selected = workers.find((w) => w.id === node.workerId);
  const isPerInstance = selected?.executionMode === "per-instance";

  const setWorkerId = (workerId: string | undefined) => onChange({ ...node, workerId });

  return (
    <div style={{ padding: 8 }}>
      <div style={{ color: "#ccc", fontSize: 12, marginBottom: 6 }}>Run on worker (override)</div>
      <select
        value={node.workerId ?? ""}
        disabled={readOnly}
        onChange={(e) => setWorkerId(e.target.value || undefined)}
        style={{ width: "100%", padding: "4px", borderRadius: "4px" }}
      >
        <option value="">Use workflow worker</option>
        {workers.map((w) => (
          <option key={w.id} value={w.id}>{w.name} ({w.type} · {w.executionMode})</option>
        ))}
      </select>
      {overridden && isPerInstance && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#e0a458" }}>
          ⚠ This worker has its own isolated /workspace. It won't see the clone/edits from this
          run's main worker — keep workspace-touching steps (clone/analyze/plan/implement/commit)
          on one worker.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the tab in the node properties panel**

Find the node properties panel host (the component that renders tabs like `ConfigTab` / `McpToolsTab` — search `packages/flow-editor/src/properties-panel/` for where `McpToolsTab` is rendered with `orgId`). Add a "Worker" tab/section that renders:

```tsx
<WorkerTab orgId={orgId} node={node} onChange={onChange} readOnly={readOnly} />
```

Use the **same `orgId` and `node`/`onChange` props** the host already passes to `McpToolsTab`/`ConfigTab` (confirmed available there). Add a tab label "Worker" alongside the existing tab labels following the host's existing tab-registration pattern.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

---

## Task 7: Full verification (typecheck + manual preview)

**Files:** none.

- [ ] **Step 1: Typecheck both UI packages**

Run: `npm run typecheck -w @journeyman/web && npm run typecheck -w @journeyman/flow-editor`
Expected: both PASS.

- [ ] **Step 2: Repo-wide checks**

Run: `npm run check`
Expected: PASS (boundaries: web/flow-editor are `ui`; they call the API via `fetch`, no new cross-package imports).

- [ ] **Step 3: Manual preview checklist (GATED — needs api-server + DB running)**

If the stack is runnable (`npm run start:api-server` + `npm run dev:web` with a migrated DB), verify by hand; otherwise note as unverified (no UI test runner exists):
- Sidebar shows **My Workers**; admin sees **Org Workers**.
- `/me/workers` lists workers (at least the seeded `Local Workspace` is visible via the picker, though it's system-scope so it won't appear in the *My* list — that's expected; it appears in the flow-editor dropdown).
- "New worker" → type **Docker** → fields switch (connection/image/network); Save creates a row; Edit/Delete work.
- In the flow editor, **Flow Defaults → Worker** dropdown lists visible workers (incl. system "Local Workspace") and persists `defaults.workerId` on save.
- A node's **Worker** tab shows the override dropdown; selecting a `per-instance` worker shows the ⚠ workspace caveat; persists `node.workerId`.

---

## Self-Review

**Spec coverage (Plan 3-UI scope):**
- §7 management UI (create/edit/delete, user + org scope) → Tasks 2–4.
- §7/§8 Docker config form (connection local/remote, image ref/Dockerfile, network) + §18 local config (baseDir, retainWorkspace) → Task 2.
- §7 flow-level worker picker (`defaults.workerId`) → Task 5.
- §7 per-step override (`node.workerId`) + workspace caveat warning → Task 6.
- Deferred & noted: resources/env/mounts/tags fields, non-built worker types, test-connection button (Plan 4) → later UI iteration.

**Placeholder scan:** No TBD/TODO. Components are fully written. The two "find the caller/host and thread `orgId`" steps (5.2c, 6.2) are explicit wiring instructions against named existing patterns (`McpToolsTab`/`ConfigTab` already receive `orgId`), not placeholders — they exist because the exact host file/line wasn't quoted in research and must be matched in-repo. Manual/preview verification is used because **no UI test runner exists** (stated up front), and the DB-gated preview has a documented fallback.

**Type consistency:** `Worker`/`WorkerUpsertBody` (Task 1) are used by the modal (Task 2) and page (Task 3). `executionMode` is derived (`docker`→`per-instance`, else `shared`) consistently in the modal. The flow-editor pickers read/write `defaults.workerId` and `node.workerId` (added to core in Plan 3) and fetch the same `/api/orgs/:orgId/workers/visible` endpoint (Plan 3). The local `VisibleWorker` interfaces in the two flow-editor components include only the fields they read (`id/name/type/executionMode/enabled`, plus `scope` for the flow-level one).
