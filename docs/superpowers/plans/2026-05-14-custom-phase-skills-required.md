# Custom Phase: Skills-Required Flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let custom AI phases declare "skills required". Auto-populate `defaultSkillIds` on drop, surface a validation error if the flag is on and the node has zero skills, and reject phase save/promote when defaults reference resources of lower visibility scope.

**Architecture:** Add `requires_skills` boolean to the custom-phase record (DB + types + routes). On flow-editor drop, copy `defaultSkillIds` into the new node's `skillIds`. Extend the validation catalog with a per-custom-phase lookup so `validateWorkflowInputs` can emit a `missing-required` warning when a `requiresSkills` phase has empty skills. Add a server-side scope-guard helper used by phase save and promote routes.

**Tech Stack:** TypeScript, Node/Fastify (backend), React/Vite (flow-editor), PostgreSQL (`pg`), Zod, Vitest (or whatever the repo uses) for unit tests.

**User overrides:** no per-task commits; unit tests included; final task is `npm run typecheck`.

---

## File Structure

**Create:**
- `packages/migrations/src/sql/022_custom_phase_requires_skills.sql`
- `packages/custom-phases/src/scope-guard.ts`
- `packages/custom-phases/src/scope-guard.test.ts`
- `packages/custom-phases/src/db.test.ts` (only if no existing test file there)
- `packages/flow-editor/src/canvas/auto-populate-defaults.ts`
- `packages/flow-editor/src/canvas/auto-populate-defaults.test.ts`

**Modify:**
- `packages/core/src/types/custom-phases.types.ts` — add `requiresSkills` to `CustomAiPhase` + `CustomAiPhaseCreateInput`
- `packages/core/src/utils/validate-workflow.ts` — extend `ValidationCatalog` and `validateWorkflowInputs`
- `packages/custom-phases/src/db.ts` — read/write `requires_skills` column
- `packages/custom-phases/src/catalog.ts` — expose `requiresSkills` in `CustomPhaseCatalogEntry`
- `packages/custom-phases/src/routes/user-custom-phases.ts` — accept `requiresSkills`, wire scope-guard on POST/PATCH/promote
- `packages/custom-phases/src/routes/org-custom-phases.ts` — accept `requiresSkills`, wire scope-guard on PATCH
- `packages/flow-editor/src/properties-panel/use-validation-catalog.ts` — pass per-custom-phase entries
- `packages/flow-editor/src/canvas/Canvas.tsx` — call auto-populate after node creation
- `packages/phases/src/custom/CustomAiConfigForm.tsx` *(admin form — see Task 9)* — add `Skills required` checkbox + soft warning

---

## Task 1: DB migration

**Files:**
- Create: `packages/migrations/src/sql/022_custom_phase_requires_skills.sql`

- [ ] **Step 1.1: Write the migration SQL**

```sql
ALTER TABLE jm_custom_ai_phases
  ADD COLUMN requires_skills boolean NOT NULL DEFAULT false;
```

- [ ] **Step 1.2: Verify the migration runner picks up the file**

Run: `ls packages/migrations/src/sql/ | sort`
Expected: `022_custom_phase_requires_skills.sql` appears immediately after `021_custom_phase_slots.sql`.

The migration runner in this repo loads `.sql` files in sorted order. No registration step is required.

---

## Task 2: Core type field

**Files:**
- Modify: `packages/core/src/types/custom-phases.types.ts`

- [ ] **Step 2.1: Add `requiresSkills` to `CustomAiPhase`**

In `CustomAiPhase` (around line 25), add immediately after `defaultSkillIds: string[];`:

```ts
  /** When true, a flow author must attach at least one skill to any node that uses this phase. */
  requiresSkills: boolean;
```

- [ ] **Step 2.2: Add `requiresSkills` to `CustomAiPhaseCreateInput`**

In `CustomAiPhaseCreateInput` (around line 46), add immediately after `defaultSkillIds?: string[];`:

```ts
  requiresSkills?: boolean;
```

(No change needed to `CustomAiPhaseUpdateInput` — it's a `Partial<>` of the create input.)

---

## Task 3: DB adapter read/write

**Files:**
- Modify: `packages/custom-phases/src/db.ts`

- [ ] **Step 3.1: Read the new column in `rowToPhase`**

In `rowToPhase`, add after `defaultSkillIds: r.default_skill_ids ?? [],`:

```ts
    requiresSkills: r.requires_skills ?? false,
```

- [ ] **Step 3.2: Persist on INSERT**

In `insertCustomAiPhase`, extend the SQL and values array. Replace the existing `INSERT` block with:

```ts
    const { rows } = await pool.query(
      `INSERT INTO jm_custom_ai_phases
         (scope, user_id, org_id, name, description,
          input_fields, output_mode, output_schema,
          prompt_template, default_tools,
          default_mcp_ids, default_skill_ids,
          slots,
          requires_skills,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        input.scope,
        input.userId,
        input.orgId,
        input.name,
        input.description ?? "",
        JSON.stringify(input.inputFields ?? []),
        input.outputMode ?? "none",
        input.outputSchema ? JSON.stringify(input.outputSchema) : null,
        input.promptTemplate ?? "",
        JSON.stringify(input.defaultTools ?? []),
        JSON.stringify(input.defaultMcpIds ?? []),
        JSON.stringify(input.defaultSkillIds ?? []),
        JSON.stringify(input.slots ?? []),
        input.requiresSkills ?? false,
        input.createdBy,
      ],
    );
```

- [ ] **Step 3.3: Persist on UPDATE**

In `updateCustomAiPhase`, add this line immediately after the `defaultSkillIds` push:

```ts
  if (patch.requiresSkills !== undefined) push("requires_skills", patch.requiresSkills);
```

---

## Task 4: Scope-guard helper

**Files:**
- Create: `packages/custom-phases/src/scope-guard.ts`
- Create: `packages/custom-phases/src/scope-guard.test.ts`

The guard enforces: a phase at scope X may only reference skills/MCPs whose scope is ≥ X (user < org < global). It throws a typed error listing every offending entry so route handlers can format a 400 response.

- [ ] **Step 4.1: Write the failing test**

`packages/custom-phases/src/scope-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertScopeSafeDefaults, ScopeViolationError } from "./scope-guard.ts";

const lookup = {
  skill: async (id: string) => {
    if (id === "user-skill") return { scope: "user" as const };
    if (id === "org-skill") return { scope: "org" as const };
    if (id === "global-skill") return { scope: "global" as const };
    return null;
  },
  mcp: async (id: string) => {
    if (id === "user-mcp") return { scope: "user" as const };
    if (id === "org-mcp") return { scope: "org" as const };
    return null;
  },
};

describe("assertScopeSafeDefaults", () => {
  it("allows user phase to reference user/org/global resources", async () => {
    await expect(assertScopeSafeDefaults({
      phaseScope: "user",
      defaultSkillIds: ["user-skill", "org-skill", "global-skill"],
      defaultMcpIds: ["user-mcp", "org-mcp"],
      lookup,
    })).resolves.toBeUndefined();
  });

  it("rejects org phase referencing a user-scoped skill", async () => {
    await expect(assertScopeSafeDefaults({
      phaseScope: "org",
      defaultSkillIds: ["user-skill"],
      defaultMcpIds: [],
      lookup,
    })).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("error lists every offending entry", async () => {
    try {
      await assertScopeSafeDefaults({
        phaseScope: "org",
        defaultSkillIds: ["user-skill", "org-skill"],
        defaultMcpIds: ["user-mcp"],
        lookup,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeViolationError);
      const e = err as ScopeViolationError;
      expect(e.offenders).toEqual([
        { kind: "skill", id: "user-skill", scope: "user" },
        { kind: "mcp",   id: "user-mcp",   scope: "user" },
      ]);
    }
  });

  it("rejects unknown skill IDs as offenders", async () => {
    await expect(assertScopeSafeDefaults({
      phaseScope: "org",
      defaultSkillIds: ["does-not-exist"],
      defaultMcpIds: [],
      lookup,
    })).rejects.toBeInstanceOf(ScopeViolationError);
  });
});
```

- [ ] **Step 4.2: Implement `scope-guard.ts`**

`packages/custom-phases/src/scope-guard.ts`:

```ts
export type ResourceScope = "user" | "org" | "global";
export type PhaseScope = "user" | "org";

const SCOPE_RANK: Record<ResourceScope, number> = { user: 0, org: 1, global: 2 };

export interface ScopeLookup {
  skill: (id: string) => Promise<{ scope: ResourceScope } | null>;
  mcp:   (id: string) => Promise<{ scope: ResourceScope } | null>;
}

export interface ScopeOffender {
  kind: "skill" | "mcp";
  id: string;
  scope: ResourceScope | "unknown";
}

export class ScopeViolationError extends Error {
  readonly offenders: ScopeOffender[];
  constructor(offenders: ScopeOffender[]) {
    super(`Scope violation: ${offenders.map(o => `${o.kind}:${o.id} (${o.scope})`).join(", ")}`);
    this.name = "ScopeViolationError";
    this.offenders = offenders;
  }
}

export async function assertScopeSafeDefaults(args: {
  phaseScope: PhaseScope;
  defaultSkillIds: string[];
  defaultMcpIds: string[];
  lookup: ScopeLookup;
}): Promise<void> {
  const minRank = SCOPE_RANK[args.phaseScope];
  const offenders: ScopeOffender[] = [];

  for (const id of args.defaultSkillIds) {
    const rec = await args.lookup.skill(id);
    if (!rec) { offenders.push({ kind: "skill", id, scope: "unknown" }); continue; }
    if (SCOPE_RANK[rec.scope] < minRank) offenders.push({ kind: "skill", id, scope: rec.scope });
  }
  for (const id of args.defaultMcpIds) {
    const rec = await args.lookup.mcp(id);
    if (!rec) { offenders.push({ kind: "mcp", id, scope: "unknown" }); continue; }
    if (SCOPE_RANK[rec.scope] < minRank) offenders.push({ kind: "mcp", id, scope: rec.scope });
  }

  if (offenders.length > 0) throw new ScopeViolationError(offenders);
}
```

- [ ] **Step 4.3: Re-export from package index**

In `packages/custom-phases/src/index.ts`, append:

```ts
export { assertScopeSafeDefaults, ScopeViolationError } from "./scope-guard.ts";
export type { ScopeLookup, ScopeOffender, ResourceScope, PhaseScope } from "./scope-guard.ts";
```

- [ ] **Step 4.4: Run the tests**

Run: `npm test -w @journeyman/custom-phases -- scope-guard`
Expected: all four tests pass.

---

## Task 5: Routes — accept `requiresSkills` + wire scope guard

**Files:**
- Modify: `packages/custom-phases/src/routes/user-custom-phases.ts`
- Modify: `packages/custom-phases/src/routes/org-custom-phases.ts`

The scope-guard needs a `ScopeLookup` implementation that queries the live skill/MCP tables. We thread this through from the app boot wiring (which already owns the `pool`); the routes accept a `lookup` factory or build one inline.

- [ ] **Step 5.1: Add a shared lookup builder**

Create `packages/custom-phases/src/scope-lookup.ts`:

```ts
import type { Pool } from "pg";
import type { ScopeLookup, ResourceScope } from "./scope-guard.ts";

export function buildScopeLookup(pool: Pool): ScopeLookup {
  return {
    skill: async (id) => {
      const { rows } = await pool.query<{ scope: ResourceScope }>(
        `SELECT scope FROM jm_skills WHERE id = $1`, [id],
      );
      return rows[0] ?? null;
    },
    mcp: async (id) => {
      const { rows } = await pool.query<{ scope: ResourceScope }>(
        `SELECT scope FROM jm_mcp_instances WHERE id = $1`, [id],
      );
      return rows[0] ?? null;
    },
  };
}
```

(If the table or column names differ in the existing repo schema, the SQL must match the actual `jm_skills` / `jm_mcp_instances` tables; check those files before running.)

Re-export it from `packages/custom-phases/src/index.ts`:

```ts
export { buildScopeLookup } from "./scope-lookup.ts";
```

- [ ] **Step 5.2: Add helper that maps `ScopeViolationError` → 400 response**

At the top of `packages/custom-phases/src/routes/user-custom-phases.ts` (and `org-custom-phases.ts`), add the import and helper:

```ts
import { assertScopeSafeDefaults, ScopeViolationError } from "../scope-guard.ts";
import { buildScopeLookup } from "../scope-lookup.ts";
```

```ts
function formatScopeError(err: ScopeViolationError): string {
  const list = err.offenders.map(o => `${o.kind} '${o.id}' (${o.scope}-scoped)`).join(", ");
  return `Cannot save: defaults reference scope-incompatible resources — ${list}. ` +
         `Either promote those resources or remove them from the defaults.`;
}
```

- [ ] **Step 5.3: Wire scope guard into user POST**

In `registerUserCustomPhaseRoutes`, inside the `POST /api/orgs/:orgId/users/me/custom-phases` handler, after the `parseSlots`/`parseDefaultTools` calls and before `insertCustomAiPhase`, add:

```ts
        const skillIds  = Array.isArray(body.defaultSkillIds) ? body.defaultSkillIds as string[] : [];
        const mcpIds    = Array.isArray(body.defaultMcpIds)   ? body.defaultMcpIds   as string[] : [];
        try {
          await assertScopeSafeDefaults({
            phaseScope: "user",
            defaultSkillIds: skillIds,
            defaultMcpIds: mcpIds,
            lookup: buildScopeLookup(pool),
          });
        } catch (e) {
          if (e instanceof ScopeViolationError) return reply.code(400).send({ error: formatScopeError(e) });
          throw e;
        }
```

Then extend the `insertCustomAiPhase` call to also pass through:

```ts
          requiresSkills: typeof body.requiresSkills === "boolean" ? body.requiresSkills : false,
```

- [ ] **Step 5.4: Wire scope guard into user PATCH**

In the user `PATCH` handler, after the existing `patch` object is built, but before `updateCustomAiPhase`, add:

```ts
        const skillIds = patch.defaultSkillIds ?? existing.defaultSkillIds;
        const mcpIds   = patch.defaultMcpIds   ?? existing.defaultMcpIds;
        try {
          await assertScopeSafeDefaults({
            phaseScope: existing.scope,
            defaultSkillIds: skillIds,
            defaultMcpIds: mcpIds,
            lookup: buildScopeLookup(pool),
          });
        } catch (e) {
          if (e instanceof ScopeViolationError) return reply.code(400).send({ error: formatScopeError(e) });
          throw e;
        }
```

The `requiresSkills` field on `patch` flows through automatically via the spread `...patchBody`.

- [ ] **Step 5.5: Wire scope guard into promote**

Replace the body of the `POST /api/orgs/:orgId/users/me/custom-phases/:id/promote` handler with:

```ts
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        await assertScopeSafeDefaults({
          phaseScope: "org",
          defaultSkillIds: existing.defaultSkillIds,
          defaultMcpIds: existing.defaultMcpIds,
          lookup: buildScopeLookup(pool),
        });
      } catch (e) {
        if (e instanceof ScopeViolationError) {
          const list = e.offenders.map(o => `${o.kind} '${o.id}' is ${o.scope}-scoped`).join(", ");
          return reply.code(400).send({
            error: `Cannot promote to org: ${list}. Promote those resources first, or remove them from the defaults.`,
          });
        }
        throw e;
      }
      const result = await promoteCustomAiPhaseToOrg(pool, id, ctx.user.id);
      if (!result) return reply.code(404).send({ error: "Not found" });
      return result;
```

- [ ] **Step 5.6: Wire scope guard into org PATCH**

In `packages/custom-phases/src/routes/org-custom-phases.ts`, inside the `PATCH /api/orgs/:orgId/custom-phases/:id` handler, after the `patch` object is built and before `updateCustomAiPhase`, add the same block as Step 5.4 but with `phaseScope: "org"`:

```ts
        const skillIds = patch.defaultSkillIds ?? existing.defaultSkillIds;
        const mcpIds   = patch.defaultMcpIds   ?? existing.defaultMcpIds;
        try {
          await assertScopeSafeDefaults({
            phaseScope: "org",
            defaultSkillIds: skillIds,
            defaultMcpIds: mcpIds,
            lookup: buildScopeLookup(pool),
          });
        } catch (e) {
          if (e instanceof ScopeViolationError) return reply.code(400).send({ error: formatScopeError(e) });
          throw e;
        }
```

---

## Task 6: Catalog exposure for the flow editor

**Files:**
- Modify: `packages/custom-phases/src/catalog.ts`

- [ ] **Step 6.1: Add fields to `CustomPhaseCatalogEntry`**

Extend the interface and the returned object:

```ts
export interface CustomPhaseCatalogEntry {
  phaseType: "custom-ai";
  customPhaseId: string;
  scopeBadge: "user" | "org";
  category: "Custom";
  label: string;
  description: string;
  inputFields: CustomAiPhase["inputFields"];
  outputMode: CustomAiPhase["outputMode"];
  outputSchema?: CustomAiPhase["outputSchema"];
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  slots: SecretSlotDef[];
  requiresSkills: boolean;
}
```

In `buildCustomPhaseCatalog`, add to the mapped entry:

```ts
    requiresSkills: p.requiresSkills,
```

(No other changes — `useCustomPhaseDefs` already returns full `CustomAiPhase` records, which now carry `requiresSkills` from Task 2/3.)

---

## Task 7: Validator extension

**Files:**
- Modify: `packages/core/src/utils/validate-workflow.ts`

The validator needs a per-custom-phase lookup. We extend `ValidationCatalog` from a flat record to an object with an optional `customPhases` map keyed by `customPhaseId`.

- [ ] **Step 7.1: Write the failing test**

Create `packages/core/src/utils/validate-workflow.skills-required.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateWorkflowInputs } from "./validate-workflow.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

function flowWithCustomAi(skillIds: string[]): WorkflowGraph {
  return {
    nodes: [
      { id: "start", type: "start", displayName: "Start", config: {}, position: { x: 0, y: 0 } },
      {
        id: "n1",
        type: "phase",
        phaseType: "custom-ai",
        displayName: "Code Review",
        config: { customPhaseId: "cp-1", skillIds },
        position: { x: 100, y: 0 },
      },
      { id: "end", type: "end", displayName: "End", config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [
      { id: "e1", source: "start", target: "n1", type: "default" },
      { id: "e2", source: "n1", target: "end", type: "default" },
    ],
  } as unknown as WorkflowGraph;
}

const catalog = {
  "custom-ai": { inputFields: {}, outputSchema: null },
  customPhases: {
    "cp-1": { name: "Code Review", requiresSkills: true, defaultSkillIds: ["code-reviewer"] },
  },
};

describe("validateWorkflowInputs — requiresSkills", () => {
  it("emits missing-required when requiresSkills is true and skillIds is empty", () => {
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), catalog);
    const w = warnings.find(w => w.code === "missing-required" && w.nodeId === "n1" && w.inputKey === "skillIds");
    expect(w).toBeDefined();
    expect(w!.message).toContain("Code Review");
    expect(w!.message).toContain("requires at least one skill");
    expect(w!.message).toContain("code-reviewer");
  });

  it("passes when skillIds has at least one entry", () => {
    const warnings = validateWorkflowInputs(flowWithCustomAi(["any-skill"]), catalog);
    expect(warnings.find(w => w.nodeId === "n1" && w.inputKey === "skillIds")).toBeUndefined();
  });

  it("passes when requiresSkills is false even if skillIds is empty", () => {
    const customCatalog = {
      ...catalog,
      customPhases: { "cp-1": { name: "Code Review", requiresSkills: false, defaultSkillIds: [] } },
    };
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), customCatalog);
    expect(warnings.find(w => w.nodeId === "n1" && w.inputKey === "skillIds")).toBeUndefined();
  });

  it("does not crash when phase def is missing from catalog", () => {
    const customCatalog = { "custom-ai": { inputFields: {}, outputSchema: null }, customPhases: {} };
    const warnings = validateWorkflowInputs(flowWithCustomAi([]), customCatalog);
    expect(warnings.find(w => w.nodeId === "n1" && w.inputKey === "skillIds")).toBeUndefined();
  });
});
```

- [ ] **Step 7.2: Extend `ValidationCatalog` type**

In `packages/core/src/utils/validate-workflow.ts`, replace the existing `ValidationCatalog` type with:

```ts
export interface CustomPhaseValidationEntry {
  name: string;
  requiresSkills: boolean;
  defaultSkillIds: string[];
}

export type ValidationCatalog =
  Record<string /* phaseType */, ValidationCatalogEntry> &
  { customPhases?: Record<string /* customPhaseId */, CustomPhaseValidationEntry> };
```

Note: the `customPhases` key intentionally collides with no valid `phaseType` string in the registry (no phaseType is literally `customPhases`). The compile-time intersection works because TypeScript widens the index signature.

If the compiler rejects this intersection, switch to a wrapper type instead:

```ts
export type ValidationCatalog = {
  phases: Record<string, ValidationCatalogEntry>;
  customPhases?: Record<string, CustomPhaseValidationEntry>;
};
```

…and update every read site (`catalog[node.phaseType]` → `catalog.phases[node.phaseType]`) in this file and at the call sites listed in Task 8.

- [ ] **Step 7.3: Add the validator rule**

Inside `validateWorkflowInputs`, after the existing per-node loop body (i.e., right before the loop's closing `}`), add a custom-ai-specific check. Insert this block immediately after the `for (const [key, fieldDef] of Object.entries(entry.inputFields))` loop, still inside the outer `for (const node of flow.nodes)`:

```ts
    if (node.phaseType === "custom-ai") {
      const cpId = (node.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      const cps = (catalog as { customPhases?: Record<string, CustomPhaseValidationEntry> }).customPhases;
      const cpDef = typeof cpId === "string" ? cps?.[cpId] : undefined;
      if (cpDef?.requiresSkills) {
        const skillIds = (node.config as { skillIds?: unknown } | undefined)?.skillIds;
        const count = Array.isArray(skillIds) ? skillIds.length : 0;
        if (count === 0) {
          const suggested = cpDef.defaultSkillIds.length > 0
            ? ` Suggested: ${cpDef.defaultSkillIds.join(", ")}.`
            : "";
          warnings.push({
            code: "missing-required",
            message: `${cpDef.name}: this phase requires at least one skill.${suggested} Add a skill in the Skills tab.`,
            nodeId: node.id,
            inputKey: "skillIds",
          });
        }
      }
    }
```

- [ ] **Step 7.4: Run the tests**

Run: `npm test -w @journeyman/core -- validate-workflow.skills-required`
Expected: all four tests pass.

---

## Task 8: Wire the catalog through `useValidationCatalog`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/use-validation-catalog.ts`
- Modify: `packages/flow-editor/src/FlowEditor.tsx` and `packages/flow-editor/src/topbar/Topbar.tsx` *(only if you took the wrapper-type fallback in Task 7.2)*

- [ ] **Step 8.1: Collect customPhaseIds from the current flow**

In `use-validation-catalog.ts`, replace the file contents with:

```ts
import { useMemo } from "react";
import type { ValidationCatalog, CustomPhaseValidationEntry, WorkflowGraph, CustomAiPhase } from "@journeyman/core";
import { usePhaseCatalog } from "../catalogs/use-phase-catalog.ts";
import { useCustomPhaseDefs } from "../catalogs/use-custom-phase-defs.ts";

function collectCustomPhaseIds(flow: WorkflowGraph | null | undefined): string[] {
  if (!flow) return [];
  const ids = new Set<string>();
  for (const n of flow.nodes) {
    if (n.type !== "phase" || n.phaseType !== "custom-ai") continue;
    const id = (n.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
    if (typeof id === "string" && id) ids.add(id);
  }
  return Array.from(ids);
}

export function useValidationCatalog(flow?: WorkflowGraph | null): ValidationCatalog {
  const catalog = usePhaseCatalog();
  const customIds = useMemo(() => collectCustomPhaseIds(flow), [flow]);
  const defs = useCustomPhaseDefs(customIds);

  return useMemo(() => {
    const out: ValidationCatalog = {};
    for (const [phaseType, entry] of Object.entries(catalog)) {
      out[phaseType] = {
        inputFields: entry.inputFields,
        outputSchema: entry.outputSchema,
      };
    }
    const customPhases: Record<string, CustomPhaseValidationEntry> = {};
    for (const [id, def] of Object.entries(defs)) {
      if (!def) continue;
      const d = def as CustomAiPhase;
      customPhases[id] = {
        name: d.name,
        requiresSkills: d.requiresSkills ?? false,
        defaultSkillIds: d.defaultSkillIds ?? [],
      };
    }
    (out as { customPhases?: Record<string, CustomPhaseValidationEntry> }).customPhases = customPhases;
    return out;
  }, [catalog, defs]);
}
```

- [ ] **Step 8.2: Pass the flow into the hook from call sites**

`packages/flow-editor/src/FlowEditor.tsx` — change:

```ts
const validationCatalog = useValidationCatalog();
```

to:

```ts
const validationCatalog = useValidationCatalog(heal.healed);
```

`packages/flow-editor/src/topbar/Topbar.tsx` — change:

```ts
const validationCatalog = useValidationCatalog();
```

to:

```ts
const validationCatalog = useValidationCatalog(p.flow);
```

- [ ] **Step 8.3: Re-export the new core types**

In `packages/core/src/index.ts`, add `CustomPhaseValidationEntry` to the existing block exporting `ValidationCatalog`:

```ts
  CustomPhaseValidationEntry,
```

---

## Task 9: Custom phase admin form — checkbox + soft warning

**Files:**
- Locate the admin form for editing a custom phase definition (e.g. `/me/custom-phases` page).

This plan assumes the admin form lives outside `packages/phases/src/custom/CustomAiConfigForm.tsx` (that file is the **flow-editor inspector**, not the catalog editor). If the repo has a `CustomPhaseEditor` component (likely under a `web/` or `apps/` directory tree), modify it; otherwise grep and locate first.

- [ ] **Step 9.1: Find the form**

Run: `grep -rn "defaultSkillIds" packages/ apps/ web/ 2>/dev/null | grep -v test | grep -v ".d.ts"`
Pick the file that renders the phase create/edit UI (contains an input or picker bound to `defaultSkillIds`).

- [ ] **Step 9.2: Add the checkbox**

Inside the form, immediately below the "Default skills" field, render:

```tsx
<div style={{ marginTop: 8 }}>
  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <input
      type="checkbox"
      checked={!!phase.requiresSkills}
      onChange={(e) => onChange({ ...phase, requiresSkills: e.target.checked })}
    />
    <span>Skills required</span>
  </label>
  <div className="je-props__field-help">
    Workflows using this phase must have at least one skill attached.
  </div>
  {phase.requiresSkills && (phase.defaultSkillIds?.length ?? 0) === 0 && (
    <div className="je-props__field-help" style={{ color: "#e0a800", marginTop: 4 }}>
      ⚠ No default skills set. Flow authors will have to pick skills manually each time.
      Consider adding defaults so the phase works out of the box.
    </div>
  )}
</div>
```

(Adapt prop names — `phase` / `onChange` — to the form's actual state shape.)

- [ ] **Step 9.3: Send the new field on save**

Make sure the form's `POST`/`PATCH` body includes `requiresSkills` from local state. If the form already sends the full record (spread `...phase`), this is automatic; otherwise add it explicitly.

---

## Task 10: Flow-editor — auto-populate `defaultSkillIds` on drop

**Files:**
- Create: `packages/flow-editor/src/canvas/auto-populate-defaults.ts`
- Create: `packages/flow-editor/src/canvas/auto-populate-defaults.test.ts`
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 10.1: Write the failing test**

`packages/flow-editor/src/canvas/auto-populate-defaults.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { autoPopulateCustomAiDefaults } from "./auto-populate-defaults.ts";
import type { WorkflowNode, CustomAiPhase } from "@journeyman/core";

function node(config: Record<string, unknown>): WorkflowNode {
  return {
    id: "n1",
    type: "phase",
    phaseType: "custom-ai",
    displayName: "x",
    config,
    position: { x: 0, y: 0 },
  } as unknown as WorkflowNode;
}

function def(overrides: Partial<CustomAiPhase>): CustomAiPhase {
  return {
    id: "cp",
    scope: "user",
    orgId: "o",
    name: "Phase",
    description: "",
    inputFields: [],
    outputMode: "none",
    promptTemplate: "",
    defaultTools: [],
    defaultMcpIds: [],
    defaultSkillIds: [],
    slots: [],
    requiresSkills: false,
    createdBy: "u",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("autoPopulateCustomAiDefaults", () => {
  it("copies defaultSkillIds into a new custom-ai node with no skills", () => {
    const out = autoPopulateCustomAiDefaults(
      node({ customPhaseId: "cp" }),
      def({ defaultSkillIds: ["a", "b"] }),
    );
    expect((out.config as { skillIds?: string[] }).skillIds).toEqual(["a", "b"]);
  });

  it("does not override existing non-empty skillIds", () => {
    const out = autoPopulateCustomAiDefaults(
      node({ customPhaseId: "cp", skillIds: ["preset"] }),
      def({ defaultSkillIds: ["a"] }),
    );
    expect((out.config as { skillIds?: string[] }).skillIds).toEqual(["preset"]);
  });

  it("leaves skillIds empty when defaultSkillIds is empty", () => {
    const out = autoPopulateCustomAiDefaults(node({ customPhaseId: "cp" }), def({ defaultSkillIds: [] }));
    expect((out.config as { skillIds?: string[] }).skillIds ?? []).toEqual([]);
  });

  it("returns node unchanged when def is null", () => {
    const n = node({ customPhaseId: "cp" });
    expect(autoPopulateCustomAiDefaults(n, null)).toBe(n);
  });

  it("returns node unchanged for non-custom-ai phase types", () => {
    const n = { ...node({}), phaseType: "analyze" } as WorkflowNode;
    expect(autoPopulateCustomAiDefaults(n, def({ defaultSkillIds: ["a"] }))).toBe(n);
  });
});
```

- [ ] **Step 10.2: Implement the helper**

`packages/flow-editor/src/canvas/auto-populate-defaults.ts`:

```ts
import type { WorkflowNode, CustomAiPhase } from "@journeyman/core";

/**
 * Copy a custom phase definition's defaults into a freshly created node.
 * Only fills `skillIds` if the node has none yet — never overrides an existing pick.
 */
export function autoPopulateCustomAiDefaults(
  node: WorkflowNode,
  def: CustomAiPhase | null,
): WorkflowNode {
  if (node.type !== "phase" || node.phaseType !== "custom-ai") return node;
  if (!def) return node;
  const cfg = (node.config ?? {}) as { skillIds?: unknown };
  const hasSkills = Array.isArray(cfg.skillIds) && cfg.skillIds.length > 0;
  if (hasSkills) return node;
  if (!def.defaultSkillIds.length) return node;
  return {
    ...node,
    config: { ...cfg, skillIds: [...def.defaultSkillIds] },
  };
}
```

- [ ] **Step 10.3: Wire it into Canvas.tsx**

In `packages/flow-editor/src/canvas/Canvas.tsx`, add the import:

```ts
import { autoPopulateCustomAiDefaults } from "./auto-populate-defaults.ts";
```

In `handleDrop`, immediately after `newNode = autoBindNewNode(newNode, flow.nodes, catalog, customPhaseDefs);`, add:

```ts
    if (newNode && newNode.phaseType === "custom-ai") {
      const cpId = (newNode.config as { customPhaseId?: unknown } | undefined)?.customPhaseId;
      const def  = typeof cpId === "string" ? customPhaseDefs[cpId] ?? null : null;
      newNode = autoPopulateCustomAiDefaults(newNode, def);
    }
```

(`customPhaseDefs` is already in scope — `autoBindNewNode` consumes it on the line above.)

- [ ] **Step 10.4: Run the tests**

Run: `npm test -w @journeyman/flow-editor -- auto-populate-defaults`
Expected: all five tests pass.

---

## Task 11: Final — full typecheck

- [ ] **Step 11.1: Run repo-wide typecheck**

Run: `npm run typecheck`
Expected: zero TypeScript errors across all workspace packages.

If `@journeyman/core` package types fail because `ValidationCatalog` is now an intersection type that doesn't infer well, fall back to the wrapper-type form documented in Task 7.2 and propagate `catalog.phases[...]` everywhere `catalog[...]` is read inside `validate-workflow.ts`. Then re-run the full typecheck.

- [ ] **Step 11.2: Run all unit tests**

Run: `npm test -ws -- --run` *(or the repo's equivalent, e.g. `npm test`)*
Expected: every suite added in Tasks 4, 7, and 10 passes, and no existing suite regresses.

---

## Coverage check (spec → tasks)

| Spec section | Implementing tasks |
|---|---|
| §1 Data model | Tasks 1, 2, 3 |
| §2 Creation/edit UI | Task 9 |
| §3 Auto-populate on drop | Task 10 |
| §3.5 Scope-safe defaults | Tasks 4, 5 |
| §4 Validation logic | Tasks 6, 7, 8 |
| §5 Migration & back-compat | Task 1 (DB default `false`), Task 2 (optional in create input), Task 10.2 (no override of existing skills) |
