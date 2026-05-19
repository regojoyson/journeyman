# Custom Phase Secret Slots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let custom AI phases declare named secret slots; resolve per-node bindings at run time; inject resolved values as env vars into the Bash tool. Workflow editor + save-time validation warn on missing/inaccessible bindings.

**Architecture:** Re-uses the existing slots/bindings model that built-in phases already use (`SecretSlotDef`, `SecretBinding`, `resolveBindings`). The only new runtime move is that the **custom-ai handler** resolves bindings itself (because slots are dynamic per `customPhaseId`, not statically declared on the phase registry entry) and passes the resulting map as `env` to `runCustomPrompt`. Provider plumbs the env into the Bash tool's child process. No prompt substitution, no auto credential wiring.

**Tech Stack:** TypeScript across `@journeyman/core`, `@journeyman/custom-phases`, `@journeyman/secrets`, `@journeyman/orchestrator`, `@journeyman/coding-cli`, `@journeyman/api-server`, `@journeyman/flow-editor`, `@journeyman/web`. Postgres migration.

**Spec:** [docs/superpowers/specs/2026-05-13-custom-phase-secret-slots-design.md](../specs/2026-05-13-custom-phase-secret-slots-design.md)

**Conventions for this plan:**
- **No commits.** Engineer runs `npm run typecheck` only at the very end (Task 18).
- **No unit tests.** Skip TDD steps — implement directly.
- Every code block shows the actual content; no placeholders.

---

## File Map

**Create:**
- `packages/migrations/src/sql/021_custom_phase_slots.sql`

**Modify (core types & schemas):**
- `packages/core/src/types/coding.types.ts` — add `env` to `RunCustomPromptOptions`
- `packages/custom-phases/src/types.ts` (or wherever `CustomAiPhase` / `CustomAiPhaseCreateInput` live — confirm in Task 1) — add `slots: SecretSlotDef[]`
- `packages/custom-phases/src/db.ts` — read/write `slots` column
- `packages/custom-phases/src/routes/*.ts` — Zod validation of `slots` on POST/PATCH
- `packages/custom-phases/src/catalog.ts` — pass `slots` through `CustomPhaseCatalogEntry`

**Modify (runtime):**
- `packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts` — resolve bindings; pass `env`
- `packages/orchestrator/src/workers/worker-harness.ts` — skip auto-resolve for `custom-ai` (slots are dynamic)
- `packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts` — accept & inject `env` into Bash tool
- `packages/coding-cli/src/providers/gemini/index.ts` — accept `env` in stub signature
- `packages/coding-cli/src/providers/codex/index.ts` — same
- (any opencode provider, if present) — same

**Modify (validation):**
- `packages/api-server/src/routes/flows.ts` — extend `computeSaveWarnings` for custom-ai nodes; add `orphan_secret_binding` warning code
- `packages/core/src/types/...` (FlowSaveWarning union — find in Task 11) — add new warning code

**Modify (editor & web UI):**
- `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` — fall back to custom-phase definition slots when `node.phaseType === "custom-ai"`
- `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` — surface requiredSecrets tab for custom-ai (visibility = "shown")
- `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx` — new **Secrets** pane between Tools and Defaults
- `packages/web/src/components/custom-phases/SecretsEditor.tsx` (CREATE) — slot row editor
- `packages/web/src/components/custom-phases/PromptPaneSidebar.tsx` (or inline in modal) — `$VAR` reminder list

---

## Task 1: Add `env` to `RunCustomPromptOptions` and confirm `CustomAiPhase` shape

**Files:**
- Modify: `packages/core/src/types/coding.types.ts:230-247`
- Read (no change yet): `packages/custom-phases/src/` — find the file that exports `CustomAiPhase` and `CustomAiPhaseCreateInput`

- [ ] **Step 1: Add `env` field to `RunCustomPromptOptions`**

In `packages/core/src/types/coding.types.ts`, locate the existing `RunCustomPromptOptions` (around line 230) and add the `env` field. Replace:

```ts
export interface RunCustomPromptOptions {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: Record<string, unknown>;
  cwd?: string;
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkillPackage[];
  /**
   * Canonical Journeyman tool names. Each provider translates to its native
   * tool names. Empty/undefined means a pure-prompt phase (no tools).
   */
  tools?: CanonicalTool[];
  sessionId?: string;
  signal?: AbortSignal;
  model?: string;
  onLog?: CodingCliLogFn;
  agentLogLevel?: AgentLogLevel;
}
```

with:

```ts
export interface RunCustomPromptOptions {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: Record<string, unknown>;
  cwd?: string;
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkillPackage[];
  /**
   * Canonical Journeyman tool names. Each provider translates to its native
   * tool names. Empty/undefined means a pure-prompt phase (no tools).
   */
  tools?: CanonicalTool[];
  /**
   * Slot-keyed env values to inject into shell-tool child processes.
   * Resolved from FlowNode.secretBindings against the phase's declared slots.
   * Provider passes this to its Bash-equivalent tool only; never substituted
   * into the prompt text.
   */
  env?: Record<string, string>;
  sessionId?: string;
  signal?: AbortSignal;
  model?: string;
  onLog?: CodingCliLogFn;
  agentLogLevel?: AgentLogLevel;
}
```

- [ ] **Step 2: Locate the `CustomAiPhase` row type**

Open `packages/custom-phases/src/index.ts` and trace the export of `CustomAiPhase` to its source file (likely `types.ts`, `schema.ts`, or inline in `db.ts`). Note the exact path — referenced as `<PHASE_TYPES_FILE>` from Task 3 onwards.

---

## Task 2: DB migration — add `slots` column

**Files:**
- Create: `packages/migrations/src/sql/021_custom_phase_slots.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE jm_custom_ai_phases
  ADD COLUMN slots jsonb NOT NULL DEFAULT '[]'::jsonb;
```

That's the entire file. Default `'[]'::jsonb` means existing phases get an empty slot list and behave identically — fully additive.

---

## Task 3: Add `slots` to the `CustomAiPhase` row type & input shapes

**Files:**
- Modify: `<PHASE_TYPES_FILE>` from Task 1.2 — add `slots` to the `CustomAiPhase`, `CustomAiPhaseCreateInput`, and `CustomAiPhaseUpdateInput` interfaces.

- [ ] **Step 1: Add `slots` to row type**

Add the import at the top of the file:

```ts
import type { SecretSlotDef } from "@journeyman/core";
```

Then add `slots: SecretSlotDef[]` to the `CustomAiPhase` interface (default `[]` on read). Example shape after edit:

```ts
export interface CustomAiPhase {
  id: string;
  scope: "user" | "org";
  userId?: string;
  orgId: string;
  name: string;
  description: string;
  inputFields: CustomPhaseInputField[];
  outputMode: "none" | "text" | "structured";
  outputSchema?: Record<string, unknown>;
  promptTemplate: string;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  slots: SecretSlotDef[];          // NEW
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add `slots` to create + update inputs**

In the same file, add `slots?: SecretSlotDef[]` to both `CustomAiPhaseCreateInput` and `CustomAiPhaseUpdateInput` (optional on input; defaults to `[]` server-side).

---

## Task 4: Persist `slots` in the DB layer

**Files:**
- Modify: `packages/custom-phases/src/db.ts`

- [ ] **Step 1: Read `slots` from the row in `rowToPhase`**

Locate `rowToPhase` (around line 15) and add the new line:

```ts
function rowToPhase(r: any): CustomAiPhase {
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    name: r.name,
    description: r.description ?? "",
    inputFields: r.input_fields ?? [],
    outputMode: r.output_mode,
    outputSchema: r.output_schema ?? undefined,
    promptTemplate: r.prompt_template ?? "",
    defaultTools: Array.isArray(r.default_tools) ? r.default_tools : [],
    defaultMcpIds: r.default_mcp_ids ?? [],
    defaultSkillIds: r.default_skill_ids ?? [],
    slots: Array.isArray(r.slots) ? r.slots : [],   // NEW
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
```

- [ ] **Step 2: Write `slots` in `insertCustomAiPhase`**

Find the INSERT statement (around line 36). Add `slots` to both the column list and the values array. Example (adjust to existing parameter numbering):

```ts
const res = await pool.query(
  `INSERT INTO jm_custom_ai_phases
     (scope, user_id, org_id, name, description, input_fields, output_mode,
      output_schema, prompt_template, default_tools, default_mcp_ids,
      default_skill_ids, slots, created_by)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
   RETURNING *`,
  [
    input.scope, input.userId, input.orgId, input.name, input.description ?? "",
    JSON.stringify(input.inputFields ?? []), input.outputMode,
    input.outputSchema ? JSON.stringify(input.outputSchema) : null,
    input.promptTemplate ?? "",
    JSON.stringify(input.defaultTools ?? []),
    JSON.stringify(input.defaultMcpIds ?? []),
    JSON.stringify(input.defaultSkillIds ?? []),
    JSON.stringify(input.slots ?? []),       // NEW
    input.createdBy,
  ],
);
return rowToPhase(res.rows[0]);
```

- [ ] **Step 3: Write `slots` in `updateCustomAiPhase`**

Find the UPDATE statement. Wherever optional fields are appended via dynamic `SET` clauses, add the same treatment for `slots`. Pattern:

```ts
if (input.slots !== undefined) {
  setClauses.push(`slots = $${idx++}`);
  values.push(JSON.stringify(input.slots));
}
```

If the file uses a single fixed UPDATE (no dynamic SET), add `slots = $N` to the column list and pass `JSON.stringify(input.slots ?? existing.slots)`.

---

## Task 5: Zod validation on POST/PATCH routes

**Files:**
- Modify: `packages/custom-phases/src/routes/user-custom-phases.ts`
- Modify: `packages/custom-phases/src/routes/org-custom-phases.ts`
- Possibly modify: shared schema file if both routes import a common Zod schema

- [ ] **Step 1: Define the slots Zod schema**

In whichever file currently exports the body schema for `POST` / `PATCH` (search for `z.object({` in the two route files), add at the top:

```ts
import { z } from "zod";

const RESERVED_ENV_PREFIXES = ["JM_"];
const RESERVED_ENV_NAMES = new Set(["PATH", "HOME", "USER", "SHELL", "PWD"]);

const slotSchema = z.object({
  name: z.string()
    .regex(/^[A-Z][A-Z0-9_]*$/, "Slot name must be SCREAMING_SNAKE_CASE")
    .refine(n => !RESERVED_ENV_PREFIXES.some(p => n.startsWith(p)),
            "Slot name must not start with JM_")
    .refine(n => !RESERVED_ENV_NAMES.has(n),
            "Slot name shadows a reserved env variable"),
  description: z.string().min(1, "Description is required"),
  optional: z.boolean().optional(),
});

const slotsSchema = z.array(slotSchema)
  .refine(arr => new Set(arr.map(s => s.name)).size === arr.length,
          "Slot names must be unique within the phase")
  .default([]);
```

- [ ] **Step 2: Add `slots` to the create body schema**

Find the existing `createBodySchema` (or equivalent name). Add `slots: slotsSchema` to its shape.

- [ ] **Step 3: Add `slots` to the patch body schema**

Find the `patchBodySchema`. Add `slots: slotsSchema.optional()` so a PATCH that omits `slots` leaves them unchanged.

- [ ] **Step 4: Repeat for org routes**

Apply the same imports + schema additions in `routes/org-custom-phases.ts`. If both files import from a shared schema module, edit that module once.

---

## Task 6: Catalog passes `slots` through

**Files:**
- Modify: `packages/custom-phases/src/catalog.ts`

- [ ] **Step 1: Add `slots` to `CustomPhaseCatalogEntry`**

Find the `CustomPhaseCatalogEntry` interface (top of the file or in `types.ts`). Add:

```ts
import type { SecretSlotDef } from "@journeyman/core";

export interface CustomPhaseCatalogEntry {
  phaseType: "custom-ai";
  customPhaseId: string;
  scopeBadge: "user" | "org";
  category: "Custom";
  label: string;
  description: string;
  inputFields: CustomPhaseInputField[];
  outputMode: "none" | "text" | "structured";
  outputSchema?: Record<string, unknown>;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  slots: SecretSlotDef[];     // NEW
}
```

- [ ] **Step 2: Map `slots` in `buildCustomPhaseCatalog`**

In the `buildCustomPhaseCatalog` function, add `slots: p.slots` to the returned object literal:

```ts
return phases.map((p) => ({
  phaseType: "custom-ai" as const,
  customPhaseId: p.id,
  scopeBadge: p.scope,
  category: "Custom" as const,
  label: p.name,
  description: p.description,
  inputFields: p.inputFields,
  outputMode: p.outputMode,
  outputSchema: p.outputSchema,
  defaultTools: p.defaultTools,
  defaultMcpIds: p.defaultMcpIds,
  defaultSkillIds: p.defaultSkillIds,
  slots: p.slots,                  // NEW
}));
```

---

## Task 7: Worker harness — skip static-slot resolution for custom-ai

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts:137-164`

**Why this matters:** The harness today calls `bindingResolver` using slots fetched from the static phase registry. For `custom-ai`, the registered phase def has empty `slots` (slots are dynamic per `customPhaseId`). If we don't short-circuit, the harness will resolve an empty env and the handler will then resolve correctly. That works, but it logs misleadingly. Cleaner: skip resolution for custom-ai and let the handler own it.

- [ ] **Step 1: Short-circuit for custom-ai**

Locate the block around line 141 (`let resolvedEnv: Record<string, string>; try { … }`). Wrap the resolver call so it's skipped when `phaseType === "custom-ai"`:

```ts
let resolvedEnv: Record<string, string>;
if (phaseType === "custom-ai") {
  // custom-ai resolves its own slots inside the handler because slots
  // are dynamic per customPhaseId, not declared on the registry entry.
  resolvedEnv = {};
  log.info({
    workflowInstanceId, nodeId, phaseType,
  }, "skipping harness slot resolution for custom-ai (handler resolves)");
} else {
  try {
    const phaseDef = this.deps.registry.get(phaseType);
    // ...existing logic unchanged...
    resolvedEnv = await this.deps.bindingResolver({
      ctx: { userId, orgId, workflowId },
      slots,
      bindings: declaredBindings,
    });
  } catch (err) {
    // ...existing error path unchanged...
  }
}
```

Keep the existing error handling exactly as-is in the `else` branch.

- [ ] **Step 2: Pass `declaredBindings` through to the handler input**

After `resolvedEnv` is built, the harness currently sets `ctx.env = resolvedEnv` and passes `phaseInput` to the handler. The handler needs access to `declaredBindings` to resolve them itself.

Find where the handler is invoked (likely `handler.run(phaseInput, ctx)`). Ensure `phaseInput` already carries `secretBindings` — per the explore report it does (conductor-converter passes it through). No change needed if so. **Verify** by skimming the lines just after the resolver block; if `secretBindings` is stripped from `phaseInput` before the handler is called, restore it.

---

## Task 8: Custom-AI handler — resolve bindings, pass env

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts`

- [ ] **Step 1: Import the resolver and binding type**

At the top of the file, add:

```ts
import { resolveBindings } from "@journeyman/secrets";
import type { SecretBinding } from "@journeyman/core";
```

- [ ] **Step 2: Resolve bindings before calling the provider**

Locate the existing flow around line 70–100 (after `effectiveTools` is computed, before `coding.runCustomPrompt(...)` is called). Insert binding resolution:

```ts
const declaredBindings =
  (input.secretBindings as Record<string, SecretBinding> | undefined) ?? {};

let env: Record<string, string>;
try {
  const { values } = await resolveBindings({
    pool: this.deps.pool,
    ctx: {
      userId: ctx.userId ?? null,
      orgId: ctx.orgId ?? null,
      workflowId: ctx.workflowId ?? null,
    },
    slots: phase.slots ?? [],
    bindings: declaredBindings,
  });
  env = values;
} catch (err: any) {
  return {
    kind: "failure",
    error: `Secret resolution failed for custom phase "${phase.name}": ${err?.message ?? err}`,
  };
}
```

**Note:** `ctx.userId`, `ctx.orgId`, `ctx.workflowId` — confirm these are present on `PhaseContext` by reading `packages/core/src/types/phase-handler.types.ts`. If they're named differently (e.g. `startedByUserId`), use those exact names. If they're not on `PhaseContext` at all, they're on the phase input — fall back to `input.startedByUserId`, `input.startedByOrgId`, `input.workflowId` (the conductor-converter passes these per the explore report).

- [ ] **Step 3: Pass `env` into `runCustomPrompt`**

Update the existing `coding.runCustomPrompt({ … })` call to include `env`:

```ts
const result = await coding.runCustomPrompt({
  prompt,
  outputMode: phase.outputMode,
  outputSchema: phase.outputSchema,
  cwd,
  mcps,
  skills,
  tools: effectiveTools,
  env,                       // NEW
  sessionId: ctx.workflowInstanceId,
  signal: ctx.signal,
  ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
  ...(model ? { model } : {}),
});
```

- [ ] **Step 4: Log slot names + binding modes (no values)**

Right after the `resolveBindings` call succeeds, add an info log line for run-time debugging — names and modes only, never values:

```ts
ctx.log(
  `Resolved ${Object.keys(env).length} secret slot(s): ` +
  (phase.slots ?? [])
    .map(s => {
      const b = declaredBindings[s.name];
      const mode = b?.mode ?? "auto";
      const scope = b?.mode === "pinned" ? `:${b.scope}` : "";
      return `${s.name}=${mode}${scope}`;
    })
    .join(", ")
);
```

---

## Task 9: Claude provider — inject `env` into the Bash tool

**Files:**
- Read: `.claude/sdk.d.ts` — confirm how the Agent SDK accepts env for Bash
- Modify: `packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts`

- [ ] **Step 1: Read the SDK type declarations for Bash env injection**

Open `.claude/sdk.d.ts` and search for `Options` (the `query()` options interface) and `Bash` tool config. Two possibilities:

1. **SDK accepts a top-level `env`** on `Options` → use it directly.
2. **SDK exposes Bash via `mcpServers` / per-tool config** with an `env` field → use that.
3. **Neither** → fall back to setting env on the worker process before `query()` and restoring afterwards.

Pick the approach the SDK actually supports. The implementation below assumes Option 1 (top-level `env`); adjust the property name to match what `Options` declares.

- [ ] **Step 2: Plumb `opts.env` into `queryOptions`**

In `run-custom-prompt.ts` around line 55 (the `queryOptions` object literal), add the env field:

```ts
const queryOptions: Record<string, unknown> = {
  ...(tools.length ? { tools, allowedTools: tools } : {}),
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  ...(mcpServers ? { mcpServers } : {}),
  ...(plugins?.length ? { plugins } : {}),
  ...(opts.cwd ? { cwd: opts.cwd } : {}),
  ...(opts.model ? { model: opts.model } : {}),
  ...(opts.env && Object.keys(opts.env).length
      ? { env: opts.env }                       // NEW — name must match SDK Options field
      : {}),
};
```

If the SDK uses a different property name (e.g. `bashEnv`, `processEnv`, or per-tool config), replace `env: opts.env` with that shape. If the SDK does **not** support env at all in v1, implement Option 3:

```ts
// Fallback: temporarily merge into process.env while query() runs.
const restore: Record<string, string | undefined> = {};
if (opts.env) {
  for (const [k, v] of Object.entries(opts.env)) {
    restore[k] = process.env[k];
    process.env[k] = v;
  }
}
try {
  for await (const msg of query({ prompt: fullPrompt, options: queryOptions as any })) {
    // ...existing loop unchanged...
  }
} finally {
  for (const [k, original] of Object.entries(restore)) {
    if (original === undefined) delete process.env[k];
    else process.env[k] = original;
  }
}
```

Use the fallback only if Step 1 confirmed the SDK has no native env hook. The merge-and-restore is correct for a single in-flight call but is not concurrency-safe — flag this in `// 12. Open implementation questions` of the spec follow-up if it ends up being the path.

---

## Task 10: Gemini, Codex, OpenCode — accept `env` in signature

**Files:**
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`
- Modify: `packages/coding-cli/src/providers/codex/index.ts`
- Modify: any `packages/coding-cli/src/providers/opencode/index.ts` if present

- [ ] **Step 1: Add `env` to the stub signatures**

Each provider's `runCustomPrompt` is a stub that throws. The signature is enforced by `ICodingCLI` (now updated in Task 1) — TypeScript will accept the existing throw. Verify there is no concrete handling of `opts.env` to add; the stubs only need to keep compiling. **No code edits expected** unless a stub destructures opts and would now warn on unused fields. If a destructure exists, accept `env` explicitly:

```ts
runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
  void opts.env;   // accepted but unused in stub
  throw new Error("GeminiProvider.runCustomPrompt not implemented");
}
```

---

## Task 11: API server — extend save-time validation

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts:28-119` (`computeSaveWarnings`)
- Modify: wherever `WorkflowSaveWarning` is defined — search for `code: "inaccessible_secrets"` to find the union type. Likely `packages/core/src/types/flow.types.ts` or `packages/api-server/src/types/...`.

- [ ] **Step 1: Add the new warning code to the union**

In the file that defines `WorkflowSaveWarning`, add:

```ts
export type WorkflowSaveWarning =
  | { code: "inaccessible_secrets"; message: string; names: string[] }
  | { code: "cross_scope_pin"; message: string; entries: Array<{
        nodeId: string; slot: string; pinnedScope: SecretScope; workflowScope: WorkflowScope;
      }>; }
  | { code: "orphan_secret_binding"; message: string; entries: Array<{
        nodeId: string; slot: string;
      }>; };
```

- [ ] **Step 2: Load custom-phase definitions for the workflow's custom-ai nodes**

At the top of `computeSaveWarnings`, after `visible` is loaded, collect custom phase IDs and fetch their definitions in bulk:

```ts
import { getCustomAiPhase } from "@journeyman/custom-phases";

const customPhaseIds = new Set<string>();
for (const node of definition.nodes) {
  if (node.phaseType === "custom-ai") {
    const id = (node.config as any)?.customPhaseId
            ?? (node.inputs as any)?.customPhaseId;
    if (typeof id === "string") customPhaseIds.add(id);
  }
}
const customPhaseSlots = new Map<string, SecretSlotDef[]>();
for (const id of customPhaseIds) {
  const p = await getCustomAiPhase(c.pool, id);
  if (p) customPhaseSlots.set(id, p.slots ?? []);
}
```

**Note:** verify the exact location of `customPhaseId` (`node.config.customPhaseId` per the parent custom-phases spec). Adjust the property access to match the live shape.

- [ ] **Step 3: Walk custom-ai nodes inside the existing node loop**

Extend the existing `for (const node of definition.nodes)` loop. After the existing binding walk:

```ts
for (const node of definition.nodes) {
  const bindings = (node.secretBindings ?? {}) as Record<string, SecretBinding>;

  // Build the set of slot names this node declares (for orphan detection).
  let declaredSlotNames: Set<string> | null = null;
  if (node.phaseType === "custom-ai") {
    const id = (node.config as any)?.customPhaseId
            ?? (node.inputs as any)?.customPhaseId;
    const slots = (typeof id === "string" ? customPhaseSlots.get(id) : undefined) ?? [];
    declaredSlotNames = new Set(slots.map(s => s.name));

    // For declared slots with NO binding entry, treat as auto and validate accessibility.
    for (const slot of slots) {
      if (slot.optional) continue;
      const binding = bindings[slot.name];
      if (!binding) {
        if (!visibleNames.has(slot.name)) inaccessible.add(slot.name);
      }
    }
  }

  for (const [slotName, binding] of Object.entries(bindings)) {
    // Orphan check (custom-ai only)
    if (declaredSlotNames && !declaredSlotNames.has(slotName)) {
      orphans.push({ nodeId: node.id, slot: slotName });
      continue;
    }

    // Existing auto / pinned validation unchanged
    if (binding.mode === "auto") {
      if (!visibleNames.has(slotName)) inaccessible.add(slotName);
      continue;
    }
    if (!visibleByScopeName.has(`${binding.scope}:${binding.name}`)) {
      inaccessible.add(binding.name);
    }
    if (isNarrowerScope(binding.scope, workflowScope)) {
      crossScope.push({ nodeId: node.id, slot: slotName, pinnedScope: binding.scope, workflowScope });
    }
  }
}
```

Declare `const orphans: Array<{ nodeId: string; slot: string }> = [];` next to the existing `inaccessible` / `crossScope` declarations at the top of the function.

- [ ] **Step 4: Emit the orphan warning**

In the warnings assembly section at the end of `computeSaveWarnings`, after the existing two pushes, add:

```ts
if (orphans.length > 0) {
  warnings.push({
    code: "orphan_secret_binding",
    message: `${orphans.length} secret binding(s) reference slots that are no longer declared on the custom phase.`,
    entries: orphans,
  });
}
```

---

## Task 12: Flow editor — RequiredSecretsTab slot fallback for custom-ai

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx:65-77`

- [ ] **Step 1: Fetch custom-phase slots when the node is custom-ai**

The current resolution at lines 72-73:

```ts
const providerSlots = PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];
const slots: SecretSlotDef[] = phaseDef?.slots?.length ? phaseDef.slots : providerSlots;
```

Add a third source — the custom phase catalog entry — for custom-ai nodes. Above the `slots` computation:

```ts
import { useCustomPhaseCatalog } from "../catalog/use-custom-phase-catalog";   // see Step 2

const customPhaseId = node.phaseType === "custom-ai"
  ? ((node.config as any)?.customPhaseId as string | undefined)
  : undefined;
const customCatalog = useCustomPhaseCatalog();
const customSlots: SecretSlotDef[] = customPhaseId
  ? (customCatalog.entries.find(e => e.customPhaseId === customPhaseId)?.slots ?? [])
  : [];

const providerSlots = PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];
const slots: SecretSlotDef[] = customSlots.length
  ? customSlots
  : (phaseDef?.slots?.length ? phaseDef.slots : providerSlots);
```

- [ ] **Step 2: Add (or re-use) `useCustomPhaseCatalog` hook**

Search the flow-editor package for an existing custom-phase catalog hook (`useCustomPhaseCatalog`, `useCustomPhases`, etc.). If one exists, import it and skip this step.

If not, create a minimal hook at `packages/flow-editor/src/catalog/use-custom-phase-catalog.ts`:

```ts
import { useEffect, useState } from "react";

export interface CustomPhaseCatalogClientEntry {
  customPhaseId: string;
  slots: { name: string; description: string; optional?: boolean }[];
  // plus whatever else the editor consumes elsewhere; if a fuller hook exists, prefer it.
}

export function useCustomPhaseCatalog() {
  const [entries, setEntries] = useState<CustomPhaseCatalogClientEntry[]>([]);
  useEffect(() => {
    fetch("/api/custom-phases/visible")
      .then(r => r.json())
      .then((data: { phases: CustomPhaseCatalogClientEntry[] }) => setEntries(data.phases ?? []))
      .catch(() => setEntries([]));
  }, []);
  return { entries };
}
```

If the actual visible endpoint path differs (e.g. `/api/orgs/:orgId/custom-phases/visible`), use that — confirm by reading `packages/custom-phases/src/routes/visible.ts`.

---

## Task 13: Flow editor — surface the Secrets tab for custom-ai

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx:85-95`

- [ ] **Step 1: Force `requiredSecrets: "shown"` for custom-ai nodes**

The existing tab visibility logic relies on a static `PhaseDefinition`. For `custom-ai`, ensure the tab is always shown:

```ts
const isPhase = node.type === "phase";
const definition = isPhase ? registry.get(node.phaseType) : undefined;
const isCustomAi = node.phaseType === "custom-ai";
const visibility: TabsVisibility = definition
  ? {
      io: definition.tabs.io,
      requiredSecrets: isCustomAi
        ? "shown"
        : (definition.tabs.requiredSecrets ?? "shown"),
      mcp: definition.tabs.mcp,
      skills: definition.tabs.skills ?? "hidden",
      retry: definition.tabs.retry,
    }
  : DEFAULT_VISIBILITY;
```

---

## Task 14: Web — Secrets pane in the custom-phase editor modal

**Files:**
- Create: `packages/web/src/components/custom-phases/SecretsEditor.tsx`
- Modify: `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx`

- [ ] **Step 1: Create `SecretsEditor.tsx`**

```tsx
import { useState } from "react";

export interface SlotRow {
  name: string;
  description: string;
  optional?: boolean;
}

export interface SecretsEditorProps {
  value: SlotRow[];
  onChange: (next: SlotRow[]) => void;
  hasBashTool: boolean;
}

const NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;
const RESERVED = new Set(["PATH", "HOME", "USER", "SHELL", "PWD"]);

export function SecretsEditor({ value, onChange, hasBashTool }: SecretsEditorProps) {
  const [draft, setDraft] = useState<SlotRow>({ name: "", description: "" });

  function add() {
    const error = validate(draft, value);
    if (error) return;
    onChange([...value, draft]);
    setDraft({ name: "", description: "" });
  }

  function remove(name: string) {
    onChange(value.filter(s => s.name !== name));
  }

  function toggleOptional(name: string) {
    onChange(value.map(s => s.name === name ? { ...s, optional: !s.optional } : s));
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Secrets</h3>
      <p className="text-sm text-gray-600">
        Declare credentials this phase needs. Each slot becomes an environment
        variable in the Bash tool (<code>$SLOT_NAME</code>).
      </p>
      {!hasBashTool && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          Add the <code>bash</code> tool to use secret slots — without it, env values have nowhere to land.
        </div>
      )}

      <ul className="space-y-2">
        {value.map(slot => (
          <li key={slot.name} className="rounded border px-3 py-2">
            <div className="flex items-center justify-between">
              <code className="font-mono">{slot.name}</code>
              <div className="flex items-center gap-3">
                <label className="text-sm">
                  <input
                    type="checkbox"
                    checked={!!slot.optional}
                    onChange={() => toggleOptional(slot.name)}
                  /> optional
                </label>
                <button type="button" onClick={() => remove(slot.name)} className="text-red-600 text-sm">
                  Remove
                </button>
              </div>
            </div>
            <div className="text-sm text-gray-700">{slot.description}</div>
          </li>
        ))}
      </ul>

      <div className="rounded border px-3 py-2 space-y-2">
        <input
          className="w-full border rounded px-2 py-1 font-mono"
          placeholder="SLOT_NAME"
          value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
        />
        <input
          className="w-full border rounded px-2 py-1"
          placeholder="What this secret is used for"
          value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.target.value })}
        />
        <button type="button" onClick={add} className="px-3 py-1 border rounded">
          + Add slot
        </button>
      </div>
    </div>
  );
}

function validate(s: SlotRow, existing: SlotRow[]): string | null {
  if (!NAME_REGEX.test(s.name)) return "Name must be SCREAMING_SNAKE_CASE";
  if (s.name.startsWith("JM_")) return "Name must not start with JM_";
  if (RESERVED.has(s.name)) return "Name shadows a reserved env variable";
  if (existing.some(e => e.name === s.name)) return "Name already used";
  if (!s.description.trim()) return "Description is required";
  return null;
}
```

- [ ] **Step 2: Wire `SecretsEditor` into `EditCustomPhaseModal`**

Open `EditCustomPhaseModal.tsx`. Find the panes list (Definition → Inputs → Output → Prompt → Tools → Defaults) and insert a **Secrets** pane between Tools and Defaults.

Locate the form state hook (likely `useState` or a form library — search for `defaultTools` to find the surrounding state). Add `slots` to the form state with default `[]`. Add the pane:

```tsx
import { SecretsEditor, type SlotRow } from "./SecretsEditor";

// in the form state (alongside defaultTools, defaultMcpIds, etc.):
const [slots, setSlots] = useState<SlotRow[]>(initial?.slots ?? []);

// when building the save payload, include:
//   slots,
```

And in the panes render:

```tsx
{activeTab === "tools" && <ToolsPicker value={defaultTools} onChange={setDefaultTools} />}
{activeTab === "secrets" && (
  <SecretsEditor
    value={slots}
    onChange={setSlots}
    hasBashTool={defaultTools.includes("bash")}
  />
)}
{activeTab === "defaults" && (/* existing */)}
```

Add a "Secrets" entry to the tab list shown to the user.

---

## Task 15: Web — `$VAR` sidebar in the Prompt pane

**Files:**
- Modify: `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx` (or wherever the Prompt pane component lives — search for `promptTemplate`)

- [ ] **Step 1: Render available `$VAR` names next to the prompt textarea**

In the Prompt pane render, find the `<textarea>` bound to `promptTemplate`. Add a sidebar listing the slot names:

```tsx
<div className="grid grid-cols-[1fr_200px] gap-3">
  <textarea
    className="w-full h-64 border rounded p-2 font-mono text-sm"
    value={promptTemplate}
    onChange={e => setPromptTemplate(e.target.value)}
  />
  <div className="text-sm">
    <div className="font-semibold mb-1">Inputs ({"{{name}}"})</div>
    <ul className="mb-3 space-y-1">
      {inputFields.map(f => (
        <li key={f.name}>
          <button
            type="button"
            className="font-mono text-left hover:underline"
            onClick={() => insertAtCursor(`{{${f.name}}}`)}
          >
            {`{{${f.name}}}`}
          </button>
        </li>
      ))}
    </ul>
    <div className="font-semibold mb-1">Env vars in $bash</div>
    <ul className="space-y-1">
      {slots.length === 0 && (
        <li className="text-gray-500">None — add secret slots</li>
      )}
      {slots.map(s => (
        <li key={s.name}>
          <button
            type="button"
            className="font-mono text-left hover:underline"
            onClick={() => insertAtCursor(`$${s.name}`)}
          >
            ${s.name}
          </button>
        </li>
      ))}
    </ul>
  </div>
</div>
```

`insertAtCursor` should append to `promptTemplate` if a ref-based cursor approach isn't already in use; minimal implementation:

```tsx
function insertAtCursor(text: string) {
  setPromptTemplate(prev => prev + text);
}
```

If the existing modal already has a cursor-aware insert helper for `{{name}}`, reuse it for `$VAR` too.

---

## Task 16: Flow editor — schema-break detection for slots

**Files:**
- Modify: wherever custom-ai schema-break detection currently lives. Search the flow-editor package for the input/output diff code mentioned in the parent custom-phases spec §"Schema-break detection" (likely `packages/flow-editor/src/validation/custom-ai-schema-diff.ts` or similar; if absent, this task creates it as a no-op extension to the existing input diff).

- [ ] **Step 1: Locate the existing diff**

```bash
grep -rn "input renamed\|Unknown input\|schema-break\|customPhaseId" packages/flow-editor/src
```

Find the function that flags renamed/removed inputs on custom-ai nodes.

- [ ] **Step 2: Add slot-level diff rules**

Extend that function to also walk slots. The shape:

```ts
function diffCustomAiSlots(
  saved: Record<string, SecretBinding> | undefined,
  current: SecretSlotDef[],
): Array<{ code: "missing_required_slot"
        | "orphan_binding"
        | "now_required_unresolvable";
        slot: string }> {
  const errors: Array<{ code: any; slot: string }> = [];
  const currentByName = new Map(current.map(s => [s.name, s]));
  const savedBindings = saved ?? {};

  for (const slot of current) {
    if (!slot.optional && !(slot.name in savedBindings)) {
      errors.push({ code: "missing_required_slot", slot: slot.name });
    }
  }
  for (const boundName of Object.keys(savedBindings)) {
    if (!currentByName.has(boundName)) {
      errors.push({ code: "orphan_binding", slot: boundName });
    }
  }
  return errors;
}
```

Plug the result into whatever the existing node-badge / error-marker mechanism uses. The exact wiring depends on the file's structure; this step matches the parent custom-phases spec's table — render `missing_required_slot` and `orphan_binding` as **errors** (block run, allow save).

If no existing schema-diff module is found, defer this task to a follow-up — note in the spec's Open Questions that schema-break for slots is implemented only server-side (via `computeSaveWarnings`) in v1.

---

## Task 17: Confirm conductor-converter passes `secretBindings` for custom-ai

**Files:**
- Read (no change expected): `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Verify**

Search for `secretBindings` in the converter. Per the explore report it's already passed through unconditionally. **If** the converter omits it for `custom-ai` (e.g. via an allowlist of node types), remove that exclusion. No edit expected.

---

## Task 18: Typecheck

- [ ] **Step 1: Run the workspace typecheck**

```bash
npm run typecheck
```

Expected: clean.

Common failure points to fix in place:
- `RunCustomPromptOptions.env` not destructured in a provider stub → see Task 10 Step 1.
- `CustomAiPhase.slots` missing where the type is constructed in tests/fixtures — add `slots: []` literal.
- `WorkflowSaveWarning` union exhaustiveness in any consumer `switch (w.code)` block → add the new case.
- `RequiredSecretsTab` props if `useCustomPhaseCatalog` returns a shape narrower than expected — broaden the hook's return type.

---

## Self-Review Summary

- **Spec §4.1 (DB migration):** Task 2 ✓
- **Spec §4.1 (validation):** Task 5 ✓ (regex, uniqueness, reserved-prefix)
- **Spec §4.2 (no schema change):** Task 17 verifies ✓
- **Spec §5 (handler resolves bindings):** Task 8 ✓
- **Spec §5 (failure modes):** Task 8 Step 2 throws on MissingSecretsError ✓
- **Spec §6 (`env` on ICodingCLI):** Task 1 ✓
- **Spec §6.1 (Claude provider plumbs to Bash):** Task 9 ✓
- **Spec §6.2 (Gemini/Codex/OpenCode):** Task 10 ✓
- **Spec §7.1 (Secrets pane in definition editor):** Task 14 ✓
- **Spec §7.2 (`$VAR` sidebar in Prompt pane):** Task 15 ✓
- **Spec §7.3 (node drawer reuses RequiredSecretsTab):** Tasks 12 + 13 ✓
- **Spec §7.4 (schema-break detection):** Task 16 (with deferral fallback noted) ✓
- **Spec §8 (computeSaveWarnings extended + `orphan_secret_binding`):** Task 11 ✓
- **Spec §9 (failure-modes matrix):** covered across Tasks 5 (save), 8 (run), 11 (publish) ✓
- **Spec §10 (security — no prompt substitution, env merge only in child):** enforced by Task 9 design ✓
- **Spec §11 (rollout order):** matches Task numbering ✓
- **Spec §12 (SDK env mechanism open question):** Task 9 Step 1 explicitly checks `.claude/sdk.d.ts` ✓
