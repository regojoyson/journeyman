# Type-Driven Worker Create/Edit Form

**Date:** 2026-06-01
**Status:** Design approved — pending implementation plan
**Related:** [2026-05-30-workers-managed-compute-targets-design.md](2026-05-30-workers-managed-compute-targets-design.md)

## 1. Summary & Scope

The worker create/edit form (`WorkerFormModal`) currently hardcodes two worker
types (`local`, `docker`) with all per-type config logic inlined. As more worker
types arrive (`machine-linux`, `machine-windows`, `ecs`, `ec2`, `kubernetes`,
`cloud` — already declared in the `WorkerType` union and planned as "later specs"
in the managed-compute-targets design), this inline approach does not scale.

This spec **restructures the form to be type-driven and drop-in extensible**: each
worker type owns its own config sub-form behind a uniform descriptor, and the Type
dropdown is rendered from an authoritative capability catalog. It also adds a
minimal **Test connection** action for Docker.

### In scope
- A static **worker-type capability catalog** in `@journeyman/workers`, with a drift
  test against the registered backends.
- `GET …/workers/types` — serve the catalog to the frontend.
- `POST …/workers/test-connection` — validate + ping a `{ type, config }` (Docker now).
- Frontend **per-type form registry** (`WorkerType → WorkerTypeForm`) and a thin
  `WorkerFormModal` shell that delegates per-type config rendering.
- Dropdown shows **all** declared types; types without a backend render disabled
  ("· coming soon").

### Out of scope (unchanged by this spec)
- Building any new compute backend (ECS, VMs, k8s, cloud) — each remains its own
  later spec.
- `agent` connectivity, tag/pool routing, per-step execution mode.
- Any change to worker resolution, provisioning, or the runner protocol.

### Non-goals / YAGNI
- No generic schema-driven form renderer. Each type gets a hand-built `ConfigForm`
  so rich UX (Dockerfile editor, image-ref/dockerfile toggle) is preserved.

## 2. Background & Key Constraint

The API server **does not hold the execution-environment registry**. Per
[composition.ts](../../../packages/api-server/src/composition.ts), the registry
(`createDefaultRegistry`) lives in the worker/orchestrator process; the API server
constructs Docker pieces inline and gates with `worker.type !== "docker"`. A literal
"endpoint reads the live registry" therefore cannot work across that process
boundary.

**Decision:** honor the "single source of truth" intent with a **static capability
catalog co-located with the backends** in `@journeyman/workers`, plus a **drift
test** asserting every registered backend matches its catalog entry. Same anti-drift
guarantee, no cross-process registry access required. The endpoint shape stays
forward-compatible: it can become dynamic later with zero frontend change.

"Available" here means **a backend exists in code** for the type (`local`, `docker`
today). Whether a given deployment has configured a daemon/host is a separate runtime
concern surfaced by Test connection / run-time errors, not by the dropdown.

## 3. Architecture

```
@journeyman/workers
  └─ worker-type-catalog.ts         NEW  WORKER_TYPE_CATALOG + types
  └─ worker-type-catalog.test.ts    NEW  drift test vs registered backends
  └─ routes/index.ts                EDIT add GET /workers/types, POST /workers/test-connection

packages/web/src/components/workers
  ├─ types/registry.ts              NEW  WorkerType → WorkerTypeForm
  ├─ types/form-controls.tsx        NEW  shared Field / CheckField / Code
  ├─ types/LocalConfigForm.tsx      NEW  extracted local config
  ├─ types/DockerConfigForm.tsx     NEW  extracted docker config (icons + hints kept)
  └─ WorkerFormModal.tsx            EDIT thin shell (name/type/isDefault + delegate)
packages/web/src/api/workers.ts     EDIT add getWorkerTypes(), testWorkerConnection()
```

**Data flow:** modal mounts → `GET /workers/types` → render Type dropdown (available
selectable; planned disabled "coming soon") → look up `workerTypeForms[selectedType]`
→ render its `ConfigForm` over `state: unknown` → optional **Test connection** →
submit (`buildConfig(state)` → existing create/update API).

## 4. Backend

### 4.1 Capability catalog — `worker-type-catalog.ts`

```ts
export interface WorkerTypeDescriptor {
  type: WorkerType;
  label: string;                              // "Docker (per-instance)"
  status: "available" | "planned";
  supportedModes: ExecutionMode[];            // from design §4 matrix
  supportedConnectivity: Connectivity[];
  summary: string;                            // one-line description for the UI
}

export const WORKER_TYPE_CATALOG: WorkerTypeDescriptor[] = [ /* all 8 types */ ];
```

- `local`, `docker` → `status: "available"`.
- `machine-linux`, `machine-windows`, `ecs`, `ec2`, `kubernetes`, `cloud` →
  `status: "planned"` with accurate modes/connectivity from the managed-compute
  design's matrix (§4).
- Pure data — no runtime imports beyond the `@journeyman/core` types.

### 4.2 Drift test — `worker-type-catalog.test.ts`

Builds the backends `createDefaultRegistry` can register (`local`, `docker`) and
asserts, for each: a catalog entry exists, its `status` is `"available"`, and its
`supportedModes` / `supportedConnectivity` equal the backend's declared values.
A new backend without a catalog update fails this test.

### 4.3 `GET /api/orgs/:orgId/workers/types`

`requireAuth()`. Returns `WORKER_TYPE_CATALOG`. Org-scope check mirrors the existing
`/workers/visible` route.

### 4.4 `POST /api/orgs/:orgId/workers/test-connection`

`requireAuth()`. Body `{ type: WorkerType, config: Record<string, unknown> }`.

- `docker`: read `config.connection` (default `{ kind: "local" }`),
  `makeDockerClient(connection)` (which now applies `normalizeSocketPath`), call
  `.ping()`. Return `{ ok: true }` or `{ ok: false, error }`.
- Any other / planned type: `{ ok: false, error: "No backend for type '<type>'" }`.
- Reuses the exact client path fixed for the `unix://`/ENOENT bug, so the same class
  of misconfiguration is caught before save.

## 5. Frontend

### 5.1 Per-type form descriptor — `types/registry.ts`

```ts
export interface WorkerTypeForm {
  icon: LucideIcon;
  readConfig: (raw: Record<string, unknown>) => unknown;     // raw → form state
  buildConfig: (state: unknown) => Record<string, unknown>;  // form state → raw
  validate?: (state: unknown) => string | null;             // inline pre-save error
  ConfigForm: React.FC<{ state: unknown; onChange: (s: unknown) => void; editing: boolean }>;
  testConnection?: boolean;                                  // show Test connection button
}

export const workerTypeForms: Partial<Record<WorkerType, WorkerTypeForm>> = {
  local:  localTypeForm,
  docker: dockerTypeForm,   // testConnection: true
};
```

### 5.2 Extracted config forms

- **`LocalConfigForm.tsx`** — `baseDir` + `retainWorkspace` (keeps `FolderOpen` /
  `Archive` field help).
- **`DockerConfigForm.tsx`** — connection / socket / host / image (ref|dockerfile) /
  network, retaining all icons + hints including the Rancher/Colima/`unix://` socket
  guidance. `testConnection: true`.
- **`form-controls.tsx`** — shared `Field`, `CheckField`, `Code` so every
  `ConfigForm` reuses the same labeled-field-with-hint look.

### 5.3 `WorkerFormModal` shell

Owns only cross-type concerns: `name`, `type`, `isDefault`, error/busy state, submit.
Per-type config lives in `state: unknown` driven by the selected descriptor.

- On mount: `GET /workers/types` → dropdown. `status: "planned"` options render
  `disabled` with a "· coming soon" suffix.
- On type select: `setState(form.readConfig(worker?.config ?? {}))`.
- **Test connection** (when `form.testConnection`): `POST /workers/test-connection`
  with `{ type, config: form.buildConfig(state) }`; show inline ✓ / error.
- On submit: run `form.validate?.(state)`; `config = form.buildConfig(state)`;
  existing `createMy/updateMy/createOrg/updateOrg` calls unchanged.
- Edit mode: type select stays locked (as today).

## 6. Testing

- **Catalog drift test** (§4.2).
- **`test-connection` route**: docker bad socket → `{ ok: false, error }`; planned
  type → "no backend"; ping-success path via a fake `IDockerClient`.
- **`buildConfig`/`readConfig` round-trip** per type:
  `readConfig(buildConfig(state))` deep-equals `state` — guards the config
  save/load cycle (the Zod-strip class of bug).
- **Modal render**: planned types render disabled; switching type swaps the
  `ConfigForm`; `validate` blocks submit.

## 7. Backward Compatibility

- No DB schema change. `jm_workers.config` shape per type is unchanged
  (`readConfig`/`buildConfig` reproduce today's exact objects).
- Existing `local`/`docker` workers load and save identically.
- The create/update API request bodies are unchanged.

## 8. Build Order

1. `worker-type-catalog.ts` + drift test.
2. `GET /workers/types` + `POST /workers/test-connection` + route tests.
3. `api/workers.ts` client methods.
4. `form-controls.tsx`; extract `LocalConfigForm` / `DockerConfigForm`; `registry.ts`.
5. Rewrite `WorkerFormModal` as the shell; wire dropdown + test-connection.
6. Round-trip + modal render tests.
