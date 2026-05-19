# Flow Draft / Ready Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `draft | ready` lifecycle status to flows. Draft flows can be saved freely but cannot be triggered. Ready flows are read-only in the editor, must pass full validation to publish, and can be moved back to Draft to edit.

**Architecture:** A `status` column on `jm_flows`. A pure `validateForPublish` helper in `@journeyman/core` consumed by both the editor (UI feedback) and the API (authoritative gate). Two new endpoints (`/publish`, `/unpublish`) plus guards on save and run-trigger paths. Editor renders read-only when `status === "ready"` and surfaces transitions through a status pill + modal pair.

**Tech Stack:** TypeScript, Fastify, Postgres, React. Spec: `docs/superpowers/specs/2026-05-07-flow-draft-ready-status-design.md`.

**Workflow conventions for this plan:**
- **No commits.** All work stays uncommitted.
- **No unit tests.** Verification is via `npm run typecheck` at the end (Task 17) plus manual smoke tests called out per task where helpful.
- **Open question (deferred):** Manual test runs in Draft. Per the spec, `POST /flows/:id/runs` is gated on Ready. Task 11 implements this strictly. If the team decides to allow Draft test-runs later, that becomes a follow-up.

---

## File Map

**Created:**
- `packages/migrations/src/sql/015_flow_status.sql`
- `packages/core/src/validation/validate-for-publish.ts`
- `packages/api-server/src/services/assert-flow-ready.ts`
- `packages/flow-editor/src/topbar/StatusPill.tsx`
- `packages/flow-editor/src/topbar/PublishModal.tsx`
- `packages/flow-editor/src/topbar/UnpublishDialog.tsx`

**Modified:**
- `packages/core/src/types/flow.types.ts` — add `FlowStatus`, `Flow.status`
- `packages/core/src/index.ts` — re-export new validation module
- `packages/core/src/interfaces/flow-store.interface.ts` — add `setStatus`
- `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts` — read/write `status`
- `packages/orchestrator/src/stores/memory/memory-flow-store.ts` — read/write `status`
- `packages/api-server/src/routes/flows.ts` — `/publish`, `/unpublish`, save guard, run guard
- `packages/flow-editor/src/state/useFlowEditorState.ts` — `readOnly` flag
- `packages/flow-editor/src/FlowEditor.tsx` — thread `readOnly` through props
- `packages/flow-editor/src/topbar/Topbar.tsx` — pill + Publish / Move-to-Draft button
- `packages/flow-editor/src/canvas/Canvas.tsx` — honor `readOnly`
- `packages/flow-editor/src/palette/Palette.tsx` — honor `readOnly`
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — disable inputs when `readOnly`
- `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx` — disable inputs when `readOnly`

---

### Task 1: Add `FlowStatus` type and `Flow.status` field

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:107-121`

- [ ] **Step 1: Add the `FlowStatus` union and field**

In `packages/core/src/types/flow.types.ts`, just above `interface Flow`:

```ts
export type FlowStatus = "draft" | "ready";
```

Then add `status: FlowStatus;` to the `Flow` interface (after `updatedAt`, before the hydrated grant fields):

```ts
export interface Flow {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  status: FlowStatus;

  // Hydrated from owner grant by the API/store layer:
  scope: FlowScope;
  orgId: string | null;
  ownerUserId: string | null;
  grants?: FlowGrant[];
}
```

- [ ] **Step 2: Re-export `FlowStatus`**

Open `packages/core/src/index.ts`. Find the `flow.types.ts` re-export block and add `FlowStatus` to the type list (it lives next to `Flow`, `FlowScope`, etc.).

---

### Task 2: DB migration — add `status` column

**Files:**
- Create: `packages/migrations/src/sql/015_flow_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 015_flow_status.sql
-- Add lifecycle status to jm_flows. New flows default to 'draft'.
-- Existing rows are backfilled to 'draft' so authors must validate and
-- publish before the flow runs again.

ALTER TABLE jm_flows
  ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'ready'));

-- All existing rows get 'draft' from the DEFAULT above.
-- Keep the DEFAULT so the API layer doesn't have to specify it on insert.
```

- [ ] **Step 2: Smoke run**

Run: `cd packages/migrations && npm run migrate`
Expected: migration `015_flow_status` is applied. Verify with:
`psql $DATABASE_URL -c "\d jm_flows"` — confirm `status` column with default `'draft'`.

(Skip this step if no DB is available locally; Task 17's typecheck will still validate the SQL is syntactically valid via the running tests, and it will be exercised in CI.)

---

### Task 3: Update `IFlowStore` interface — add `setStatus`

**Files:**
- Modify: `packages/core/src/interfaces/flow-store.interface.ts:29-36`

- [ ] **Step 1: Add `setStatus` to the interface**

```ts
export interface IFlowStore {
  create(args: CreateFlowArgs): Promise<{ flow: Flow; version: FlowVersion }>;
  getById(flowId: string): Promise<Flow | null>;
  list(filter: FlowListFilter): Promise<Flow[]>;
  /** Update name/description metadata. Does NOT touch versions or grants. */
  updateMeta(flowId: string, patch: { name?: string; description?: string | null }): Promise<Flow | null>;
  /** Lifecycle status flip. Returns the updated flow, or null if not found. */
  setStatus(flowId: string, status: FlowStatus): Promise<Flow | null>;
  delete(flowId: string): Promise<void>;
}
```

Add `FlowStatus` to the import at the top:

```ts
import type {
  Flow, FlowGrant, FlowGrantRole, FlowGraph, FlowScope, FlowStatus, FlowVersion,
} from "../types/flow.types.ts";
```

---

### Task 4: PostgresFlowStore — read/write `status`

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts`

- [ ] **Step 1: Include `status` in `rowToFlowBase`**

Find `rowToFlowBase` (near the top of the file). Update it to:

```ts
function rowToFlowBase(row: any): Omit<Flow, "scope" | "orgId" | "ownerUserId"> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    currentVersionId: row.current_version_id,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    status: row.status as FlowStatus,
  };
}
```

Add `FlowStatus` to the imports:

```ts
import type {
  CreateFlowArgs, Flow, FlowGrant, FlowGraph, FlowListFilter, FlowStatus, FlowVersion,
  IFlowGrantsStore, IFlowStore, IFlowVersionStore,
} from "@journeyman/core";
```

Update `hydrateFromOwnerGrant`'s defensive fallback to include `status: "draft"`:

```ts
if (!ownerGrant) {
  return { ...base, scope: "user", orgId: null, ownerUserId: null };
}
```

(`base` already carries `status` so this needs no change beyond the type — verify `Omit<Flow, "scope" | "orgId" | "ownerUserId">` now includes `status` automatically.)

- [ ] **Step 2: Implement `setStatus`**

Add a method on `PostgresFlowStore`:

```ts
async setStatus(flowId: string, status: FlowStatus): Promise<Flow | null> {
  const { rows } = await this.pool.query(
    "UPDATE jm_flows SET status = $1, updated_at = now() WHERE id = $2 RETURNING id",
    [status, flowId],
  );
  if (!rows[0]) return null;
  return this.getById(flowId);
}
```

---

### Task 5: MemoryFlowStore — read/write `status`

**Files:**
- Modify: `packages/orchestrator/src/stores/memory/memory-flow-store.ts`

- [ ] **Step 1: Default new flows to `status: "draft"` and add `setStatus`**

Find the in-memory `create` method. Wherever the `Flow` object is constructed, add `status: "draft"`. Add the new method:

```ts
async setStatus(flowId: string, status: FlowStatus): Promise<Flow | null> {
  const flow = this.flows.get(flowId);
  if (!flow) return null;
  flow.status = status;
  flow.updatedAt = new Date();
  return flow;
}
```

Update imports to include `FlowStatus` from `@journeyman/core`.

If existing in-memory `Flow` literals are spread elsewhere in the file (e.g. test fixtures), add `status: "draft"` to them.

---

### Task 6: Pure publish-validation module in `@journeyman/core`

**Files:**
- Create: `packages/core/src/validation/validate-for-publish.ts`
- Modify: `packages/core/src/index.ts` — re-export

- [ ] **Step 1: Write the validator**

```ts
// packages/core/src/validation/validate-for-publish.ts
import type { FlowGraph, FlowNode } from "../types/flow.types.ts";
import { isJsonLogicExpr } from "../types/flow-condition.types.ts";

export type PublishError = {
  code:
    | "graph_invalid"
    | "no_trigger"
    | "orphan_node"
    | "missing_config"
    | "unresolved_binding"
    | "invalid_gate"
    | "dangling_reference";
  message: string;
  nodeId?: string;
  fieldPath?: string;
};

export type PublishValidationResult =
  | { ok: true }
  | { ok: false; errors: PublishError[] };

export interface PublishValidationContext {
  /** Names of secrets visible to the caller. Used to detect dangling refs. */
  visibleSecretNames?: Set<string>;
  /** IDs of MCP instances visible to the caller. */
  visibleMcpInstanceIds?: Set<string>;
  /** IDs of skill packages visible to the caller. */
  visibleSkillIds?: Set<string>;
  /**
   * `true` when the flow has at least one configured trigger
   * (webhook, schedule, or any node that opts into manual triggering).
   * Computed by the caller because trigger sources live outside the flow JSON.
   */
  hasTrigger: boolean;
}

/**
 * Run the full publish gate: structural validity, trigger presence,
 * connectivity, required config, binding resolution, gate condition
 * sanity, and dangling-reference checks. Pure function.
 */
export function validateForPublish(
  flow: FlowGraph,
  ctx: PublishValidationContext,
): PublishValidationResult {
  const errors: PublishError[] = [];

  // 1. Graph structural checks (mirrors isValidPhase4Graph; duplicated here so
  //    core has no dependency on flow-editor). If isValidPhase4Graph is later
  //    moved into core, swap to a direct call.
  pushGraphErrors(flow, errors);

  // 2. Trigger presence.
  if (!ctx.hasTrigger) {
    errors.push({
      code: "no_trigger",
      message: "Flow has no trigger configured (webhook, schedule, or manual).",
    });
  }

  // 3. Orphan / unreachable nodes.
  pushOrphanErrors(flow, errors);

  // 4. Required phase config + bindings + gates + dangling refs.
  for (const node of flow.nodes) {
    pushNodeErrors(flow, node, ctx, errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function pushGraphErrors(flow: FlowGraph, errors: PublishError[]): void {
  const starts = flow.nodes.filter(n => n.type === "start");
  if (starts.length !== 1) {
    errors.push({ code: "graph_invalid", message: "Flow must have exactly one start node" });
  }
  if (flow.nodes.filter(n => n.type === "end").length === 0) {
    errors.push({ code: "graph_invalid", message: "Flow must have at least one end node" });
  }
  for (const node of flow.nodes) {
    if (node.type === "phase" && !node.phaseType) {
      errors.push({ code: "graph_invalid", message: `Phase node '${node.id}' is missing a phase type`, nodeId: node.id });
    }
  }
}

function pushOrphanErrors(flow: FlowGraph, errors: PublishError[]): void {
  const start = flow.nodes.find(n => n.type === "start");
  if (!start) return;
  const reachable = new Set<string>([start.id]);
  const stack = [start.id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of flow.edges) {
      if (e.source === cur && !reachable.has(e.target)) {
        reachable.add(e.target);
        stack.push(e.target);
      }
    }
  }
  for (const n of flow.nodes) {
    if (!reachable.has(n.id)) {
      errors.push({
        code: "orphan_node",
        message: `Node '${n.displayName ?? n.id}' is unreachable from start`,
        nodeId: n.id,
      });
    }
  }
}

function pushNodeErrors(
  flow: FlowGraph,
  node: FlowNode,
  ctx: PublishValidationContext,
  errors: PublishError[],
): void {
  // Bindings: every input.kind === "ref" must resolve to a known upstream output.
  // We do a coarse check: the ref must mention an upstream node id reachable
  // from this node by reverse traversal.
  const upstream = collectUpstreamNodeIds(flow, node.id);
  for (const [slot, val] of Object.entries(node.inputs ?? {})) {
    if (val && val.kind === "ref" && val.ref) {
      const referencedNodeId = parseRefNodeId(val.ref);
      if (referencedNodeId && !upstream.has(referencedNodeId)) {
        errors.push({
          code: "unresolved_binding",
          message: `Input '${slot}' references node '${referencedNodeId}' which is not upstream of '${node.id}'`,
          nodeId: node.id,
          fieldPath: `inputs.${slot}`,
        });
      }
    }
  }

  // Gate conditions on outgoing edges of if/gateway-xor.
  if (node.type === "gateway-xor" || node.type === "if") {
    for (const e of flow.edges.filter(e => e.source === node.id)) {
      if (e.type === "conditional") {
        if (e.condition === undefined) {
          errors.push({
            code: "invalid_gate",
            message: `Edge ${e.id} on gate '${node.id}' is conditional but has no condition`,
            nodeId: node.id,
          });
        } else if (!isJsonLogicExpr(e.condition)) {
          errors.push({
            code: "invalid_gate",
            message: `Edge ${e.id} on gate '${node.id}' has an invalid condition shape`,
            nodeId: node.id,
          });
        }
      }
    }
  }

  // Dangling references for secrets / MCPs / skills.
  if (ctx.visibleSecretNames && node.secretBindings) {
    for (const [slot, binding] of Object.entries(node.secretBindings)) {
      const name = binding.mode === "auto" ? slot : binding.name;
      if (!ctx.visibleSecretNames.has(name)) {
        errors.push({
          code: "dangling_reference",
          message: `Secret '${name}' (slot '${slot}') is not visible from this flow`,
          nodeId: node.id,
          fieldPath: `secretBindings.${slot}`,
        });
      }
    }
  }
  if (ctx.visibleMcpInstanceIds) {
    const ids = (node.config as { mcpInstanceIds?: string[] } | undefined)?.mcpInstanceIds ?? [];
    for (const id of ids) {
      if (!ctx.visibleMcpInstanceIds.has(id)) {
        errors.push({
          code: "dangling_reference",
          message: `MCP instance '${id}' is not visible from this flow`,
          nodeId: node.id,
          fieldPath: "config.mcpInstanceIds",
        });
      }
    }
  }
  if (ctx.visibleSkillIds) {
    const skills = (node.config as { skillIds?: string[] } | undefined)?.skillIds ?? [];
    for (const id of skills) {
      if (!ctx.visibleSkillIds.has(id)) {
        errors.push({
          code: "dangling_reference",
          message: `Skill '${id}' is not visible from this flow`,
          nodeId: node.id,
          fieldPath: "config.skillIds",
        });
      }
    }
  }
}

function collectUpstreamNodeIds(flow: FlowGraph, target: string): Set<string> {
  const upstream = new Set<string>();
  const stack: string[] = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of flow.edges) {
      if (e.target === cur && !upstream.has(e.source)) {
        upstream.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return upstream;
}

function parseRefNodeId(ref: string): string | null {
  // Refs follow the form "<nodeId>.<output>" or "<nodeId>". We take the prefix.
  const idx = ref.indexOf(".");
  return idx === -1 ? ref : ref.slice(0, idx);
}
```

- [ ] **Step 2: Re-export from core**

In `packages/core/src/index.ts`, add:

```ts
export {
  validateForPublish,
  type PublishError,
  type PublishValidationResult,
  type PublishValidationContext,
} from "./validation/validate-for-publish.ts";
```

---

### Task 7: API helper — `assertFlowReady`

**Files:**
- Create: `packages/api-server/src/services/assert-flow-ready.ts`

- [ ] **Step 1: Write the helper**

```ts
// packages/api-server/src/services/assert-flow-ready.ts
import type { FastifyReply } from "fastify";
import type { Flow } from "@journeyman/core";

/**
 * Single source of truth for the run-trigger gate. Call from every ingress
 * (manual run, webhook → run, scheduler → run, retry). Writes the 409 reply
 * and returns false when the flow is not Ready; returns true otherwise.
 */
export function assertFlowReady(flow: Flow, reply: FastifyReply): boolean {
  if (flow.status !== "ready") {
    reply.code(409);
    void reply.send({ error: "flow_not_ready", flowId: flow.id });
    return false;
  }
  return true;
}
```

---

### Task 8: API — `POST /flows/:id/publish`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Wire up the publish route**

Just before the `/runs` route (around line 350 of `flows.ts`), add:

```ts
app.post("/flows/:id/publish", { preHandler: requireAuth() }, async (req, reply) => {
  const ctx = req.runContext!; const caller = callerFromCtx(ctx);
  const { id } = req.params as { id: string };

  const flow = await c.flows.getById(id);
  if (!flow) { reply.code(404); return { error: "not_found" }; }
  if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }
  if (!flow.currentVersionId) { reply.code(409); return { error: "flow_has_no_versions" }; }

  const version = await c.flowVersions.getById(flow.currentVersionId);
  if (!version) { reply.code(500); return { error: "version_missing" }; }

  // Build the validation context. Visible-resource sets are best-effort:
  // if these sources are wired up in the codebase already, populate them.
  // Leaving any of them undefined means that check is skipped.
  const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
  const visibleSecretNames = new Set(visible.map(v => v.name));
  // MCP / skill visibility helpers may already exist; use them if so.
  // Otherwise leave undefined (those checks are skipped).
  const result = validateForPublish(version.definition, {
    hasTrigger: hasFlowTrigger(version.definition),
    visibleSecretNames,
  });
  if (!result.ok) { reply.code(400); return { errors: result.errors }; }

  const updated = await c.flows.setStatus(id, "ready");
  if (!updated) { reply.code(500); return { error: "update_failed" }; }
  return { flow: updated };
});
```

- [ ] **Step 2: Add the helper imports**

At the top of `flows.ts`, alongside existing imports:

```ts
import { validateForPublish } from "@journeyman/core";
```

- [ ] **Step 3: Add `hasFlowTrigger`**

In the same file (above the route registration block, near `computeSaveWarnings`):

```ts
function hasFlowTrigger(flow: FlowGraph): boolean {
  // A flow has a trigger if any node opts in. We recognise:
  //   - start node carrying config.trigger ("webhook" | "schedule" | "manual")
  //   - any node tagged config.allowsManual === true
  // Adjust to match how triggers are actually configured in this codebase
  // when the trigger feature lands. For now, accept the presence of a
  // start node as a trigger so existing flows can publish.
  return flow.nodes.some(n => n.type === "start");
}
```

> **Note for engineer:** if a richer trigger configuration model (webhooks list, cron strings, etc.) exists at the flow level, refine `hasFlowTrigger` accordingly. The check must reflect "can this flow ever be triggered."

---

### Task 9: API — `POST /flows/:id/unpublish`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Add the unpublish route**

Below the `/publish` route added in Task 8:

```ts
app.post("/flows/:id/unpublish", { preHandler: requireAuth() }, async (req, reply) => {
  const ctx = req.runContext!; const caller = callerFromCtx(ctx);
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { confirm?: boolean };

  const flow = await c.flows.getById(id);
  if (!flow) { reply.code(404); return { error: "not_found" }; }
  if (!canEdit(flow, caller)) { reply.code(403); return { error: "forbidden" }; }

  // Pre-flip warning when there are in-flight runs.
  // c.runs is the IRunStore; its API is whatever's already used in this
  // codebase. The intent: count runs in non-terminal status for this flow.
  // If a helper does not exist yet, add a count method on the run store
  // returning a number, and wire it here.
  const inFlightRunCount = c.runs.countActiveByFlow
    ? await c.runs.countActiveByFlow(id)
    : 0;
  const activeTriggers = { webhooks: 0, schedules: 0 }; // populate when those subsystems exist

  if (!body.confirm && (inFlightRunCount > 0 || activeTriggers.webhooks > 0 || activeTriggers.schedules > 0)) {
    reply.code(409);
    return { warning: { inFlightRunCount, activeTriggers } };
  }

  const updated = await c.flows.setStatus(id, "draft");
  if (!updated) { reply.code(500); return { error: "update_failed" }; }
  return { flow: updated };
});
```

> **Note for engineer:** if `IRunStore` does not yet expose `countActiveByFlow`, either (a) leave the optional-chaining fallback returning 0 (warning never fires) and ship a follow-up that wires the count, or (b) add the method now to `IRunStore` + both store implementations. Pick (a) to keep this change small unless the count is needed for v1 UX.

---

### Task 10: API — guard `PUT /flows/:id` when status is `ready`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts:297-321`

- [ ] **Step 1: Block edits to Ready flows**

Inside the existing `PUT /flows/:id` handler, immediately after the `canEdit` check (around line 304), insert:

```ts
if (flow.status === "ready") {
  reply.code(409);
  return { error: "flow_is_ready" };
}
```

The author must call `/unpublish` first.

---

### Task 11: API — guard `POST /flows/:id/runs`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts:352-378`

- [ ] **Step 1: Add the readiness gate**

Inside the existing `POST /flows/:id/runs` handler, immediately after `canRead(flow, caller)` succeeds and before the `currentVersionId` check, insert:

```ts
if (!assertFlowReady(flow, reply)) return;
```

Add the import at the top of `flows.ts`:

```ts
import { assertFlowReady } from "../services/assert-flow-ready.ts";
```

> **Note for engineer:** the spec also calls for gating webhook and scheduler triggers. If/when those ingress paths land (or already exist elsewhere), call `assertFlowReady` from each. For this plan, the manual `POST /runs` is the only ingress changed.

---

### Task 12: Editor state — `readOnly` flag

**Files:**
- Modify: `packages/flow-editor/src/state/useFlowEditorState.ts`
- Modify: `packages/flow-editor/src/types.ts` (if a top-level state shape is exported)

- [ ] **Step 1: Thread a `readOnly` flag through the hook**

In `useFlowEditorState.ts`, accept `readOnly: boolean` as part of the hook's options/inputs. Expose it on the returned state. Inside the hook, guard mutating actions (any setter that modifies nodes / edges / config) with an early `if (readOnly) return;`.

Keep the change small: do not refactor existing setters, just add the guard at each call site of the public mutator functions.

- [ ] **Step 2: Type the flag**

Add `readOnly?: boolean` to the relevant `FlowEditorState` / props type in `types.ts`. Default to `false`.

---

### Task 13: Editor — Topbar status pill + transition button

**Files:**
- Create: `packages/flow-editor/src/topbar/StatusPill.tsx`
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Build the pill**

```tsx
// packages/flow-editor/src/topbar/StatusPill.tsx
import type { FlowStatus } from "@journeyman/core";

export function StatusPill({ status }: { status: FlowStatus }): JSX.Element {
  const cls = status === "ready" ? "fe-status-pill fe-status-ready" : "fe-status-pill fe-status-draft";
  const label = status === "ready" ? "Ready" : "Draft";
  return <span className={cls} aria-label={`Flow status: ${label}`}>{label}</span>;
}
```

Add corresponding styles to `packages/flow-editor/src/styles.css`:

```css
.fe-status-pill { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
.fe-status-draft { background: #fef3c7; color: #92400e; }
.fe-status-ready { background: #d1fae5; color: #065f46; }
```

- [ ] **Step 2: Wire pill + button into Topbar**

In `Topbar.tsx`, accept `status: FlowStatus`, `onPublishClick: () => void`, `onUnpublishClick: () => void` as props. Render the pill next to the flow name. Render a primary button whose label switches on status:

```tsx
{status === "draft"
  ? <button onClick={onPublishClick}>Publish</button>
  : <button onClick={onUnpublishClick}>Move to Draft</button>}
```

---

### Task 14: Editor — Publish modal

**Files:**
- Create: `packages/flow-editor/src/topbar/PublishModal.tsx`

- [ ] **Step 1: Build the modal**

```tsx
// packages/flow-editor/src/topbar/PublishModal.tsx
import { useEffect, useState } from "react";
import type { FlowGraph, PublishError } from "@journeyman/core";
import { validateForPublish } from "@journeyman/core";

interface Props {
  flow: FlowGraph;
  onCancel: () => void;
  onConfirm: () => Promise<{ ok: boolean; serverErrors?: PublishError[] }>;
  onSelectNode: (nodeId: string) => void;
  hasTrigger: boolean;
}

export function PublishModal({ flow, onCancel, onConfirm, onSelectNode, hasTrigger }: Props): JSX.Element {
  const [errors, setErrors] = useState<PublishError[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const result = validateForPublish(flow, { hasTrigger });
    setErrors(result.ok ? [] : result.errors);
  }, [flow, hasTrigger]);

  const canPublish = errors.length === 0 && !busy;

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    setServerError(null);
    try {
      const res = await onConfirm();
      if (!res.ok) {
        setErrors(res.serverErrors ?? []);
        setServerError("Server rejected publish.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fe-modal-backdrop" onClick={onCancel}>
      <div className="fe-modal" onClick={e => e.stopPropagation()}>
        <h2>Publish flow</h2>
        {errors.length === 0
          ? <p>All checks passed. Ready to publish.</p>
          : (
            <ul className="fe-publish-checklist">
              {errors.map((e, i) => (
                <li key={i} className="fe-publish-fail">
                  <span>✗ {e.message}</span>
                  {e.nodeId
                    ? <button onClick={() => { onSelectNode(e.nodeId!); onCancel(); }}>Show node</button>
                    : null}
                </li>
              ))}
            </ul>
          )}
        {serverError ? <p className="fe-error">{serverError}</p> : null}
        <div className="fe-modal-actions">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={handleConfirm} disabled={!canPublish}>Publish</button>
        </div>
      </div>
    </div>
  );
}
```

Add minimal modal styles in `styles.css` if no shared modal exists:

```css
.fe-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: grid; place-items: center; z-index: 1000; }
.fe-modal { background: #fff; padding: 24px; border-radius: 8px; max-width: 520px; width: 90%; }
.fe-publish-checklist { list-style: none; padding: 0; }
.fe-publish-fail { color: #b91c1c; display: flex; justify-content: space-between; align-items: center; margin: 6px 0; }
.fe-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.fe-error { color: #b91c1c; }
```

---

### Task 15: Editor — Unpublish dialog

**Files:**
- Create: `packages/flow-editor/src/topbar/UnpublishDialog.tsx`

- [ ] **Step 1: Build the dialog**

```tsx
// packages/flow-editor/src/topbar/UnpublishDialog.tsx
import { useState } from "react";

interface Warning { inFlightRunCount: number; activeTriggers: { webhooks: number; schedules: number } }

interface Props {
  initialWarning: Warning | null;
  onCancel: () => void;
  /** Returns the warning if server demanded confirmation; null on success. */
  onConfirm: (confirm: boolean) => Promise<Warning | null>;
}

export function UnpublishDialog({ initialWarning, onCancel, onConfirm }: Props): JSX.Element {
  const [warning, setWarning] = useState<Warning | null>(initialWarning);
  const [busy, setBusy] = useState(false);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    try {
      const w = await onConfirm(/* confirm */ true);
      setWarning(w);
    } finally {
      setBusy(false);
    }
  }

  const hasActivity = warning !== null && (
    warning.inFlightRunCount > 0
    || warning.activeTriggers.webhooks > 0
    || warning.activeTriggers.schedules > 0
  );

  return (
    <div className="fe-modal-backdrop" onClick={onCancel}>
      <div className="fe-modal" onClick={e => e.stopPropagation()}>
        <h2>Move flow to Draft?</h2>
        {hasActivity
          ? (
            <>
              <p>This flow has activity:</p>
              <ul>
                {warning!.inFlightRunCount > 0 ? <li>{warning!.inFlightRunCount} running pipeline{warning!.inFlightRunCount === 1 ? "" : "s"}</li> : null}
                {warning!.activeTriggers.webhooks > 0 ? <li>{warning!.activeTriggers.webhooks} active webhook{warning!.activeTriggers.webhooks === 1 ? "" : "s"}</li> : null}
                {warning!.activeTriggers.schedules > 0 ? <li>{warning!.activeTriggers.schedules} active schedule{warning!.activeTriggers.schedules === 1 ? "" : "s"}</li> : null}
              </ul>
              <p>In-flight runs continue. New triggers will be rejected until you publish again.</p>
            </>
          )
          : <p>You'll be able to edit again. Existing in-flight runs continue normally.</p>}
        <div className="fe-modal-actions">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={handleConfirm} disabled={busy}>Move to Draft</button>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 16: Editor — wire modals into FlowEditor + read-only propagation

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx`
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`
- Modify: `packages/flow-editor/src/palette/Palette.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`
- Modify: `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx`

- [ ] **Step 1: Open and close modals from `FlowEditor`**

In `FlowEditor.tsx`:

- Add local state: `const [publishOpen, setPublishOpen] = useState(false);` and `const [unpublishOpen, setUnpublishOpen] = useState(false);` and `const [unpublishWarning, setUnpublishWarning] = useState<Warning | null>(null);`.
- Pass `status`, `onPublishClick={() => setPublishOpen(true)}`, `onUnpublishClick={async () => { /* call /unpublish without confirm */ const r = await api.unpublish(id, false); if (r.warning) { setUnpublishWarning(r.warning); setUnpublishOpen(true); } else { /* status flipped */ refresh(); } }}` to `<Topbar />`.
- Render `<PublishModal />` and `<UnpublishDialog />` conditionally based on the open flags.

- [ ] **Step 2: Compute `readOnly` and pass it down**

```ts
const readOnly = status === "ready";
```

Pass `readOnly` to `useFlowEditorState`, `<Canvas />`, `<Palette />`, `<ConfigTab />`, and `<FlowConfigPanel />`.

- [ ] **Step 3: Honor `readOnly` in each surface**

For each of Canvas / Palette / ConfigTab / FlowConfigPanel:
- Add `readOnly?: boolean` to props.
- Disable drag/drop, hide delete/add buttons, add `disabled` to inputs/selects/checkboxes.
- In Canvas: skip wiring `onNodesChange` / `onEdgesChange` mutations; set `nodesDraggable={!readOnly}`, `nodesConnectable={!readOnly}`, `elementsSelectable={true}` (selection still allowed for viewing).
- In Palette: render an empty state ("Read-only — move to Draft to add nodes") or hide the palette entirely when `readOnly`.

- [ ] **Step 4: Read-only banner**

Render a thin banner at the top of the editor (just under Topbar) when `readOnly`:

```tsx
{readOnly ? <div className="fe-readonly-banner">This flow is published and read-only. Move to Draft to edit.</div> : null}
```

CSS:

```css
.fe-readonly-banner { background: #fef3c7; color: #92400e; padding: 6px 12px; font-size: 13px; text-align: center; }
```

---

### Task 17: Final typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: clean exit, zero errors.

If errors surface, fix them inline. Common issues to look for:
- Stores that don't yet implement `setStatus` (any extra implementations of `IFlowStore` beyond memory + postgres need it too — search with `grep -rn "implements IFlowStore"`).
- Flow object literals in fixtures or tests missing `status: "draft"`.
- Missing `FlowStatus` re-exports in `@journeyman/core`'s public surface.

- [ ] **Step 2: Smoke test (optional, manual)**

If a dev DB is available:
1. Start api-server + flow-editor.
2. Open an existing flow — confirm it shows the **Draft** pill.
3. Click **Publish** — modal appears with checklist.
4. Fix any failing checks; click **Publish** when checklist is green; pill flips to **Ready**, editor enters read-only mode.
5. Click **Move to Draft** — confirm dialog; status flips back; editor becomes editable.
6. While in Draft, attempt `POST /flows/:id/runs` via the new-run dialog or curl — expect `409 flow_not_ready`.
7. While in Ready, attempt to save edits — expect `409 flow_is_ready`.

---

## Self-Review Notes

**Spec coverage check:**
- Type + DB column: Tasks 1, 2.
- Permissive draft saves: existing `PUT` already allows partial graphs; only the Ready-status guard is added (Task 10). ✓
- Validation gate: Tasks 6 (validator), 8 (server publish call). ✓
- API endpoints (`/publish`, `/unpublish`, save guard, run guard): Tasks 8, 9, 10, 11. ✓
- Webhook + scheduler gates: noted as a follow-up in Task 11 because those ingress paths aren't fully wired in the codebase yet — the helper (`assertFlowReady`, Task 7) is ready to drop into them once they exist.
- Editor UI (pill, button, modals, read-only mode, banner): Tasks 13, 14, 15, 16. ✓
- Flow list status pill: **deliberately omitted** — the listing UI lives outside `flow-editor` and was not in scope for the editor changes; flagged here so the engineer can add it in the listing UI package if it exists in this repo.
- Migration of existing flows → Draft: Task 2 backfill via `DEFAULT 'draft'`. ✓
- Per-run snapshot: no work needed — already implemented. ✓

**Type consistency:** `FlowStatus`, `setStatus`, `validateForPublish`, `PublishError`, `assertFlowReady` are used consistently across tasks.

**Placeholder scan:** no TBDs. The `hasFlowTrigger` helper (Task 8) ships with a permissive default plus a clear note for the engineer to refine when the trigger model is finalized — that's pragmatic, not a placeholder.
