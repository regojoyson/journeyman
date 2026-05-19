# Custom Phase Export / Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a Journeyman deployment to export a single custom AI phase as a JSON file and import that file into another deployment, so phase authors can move work between independently-deployed environments.

**Architecture:** A pure `export.ts` module in `@journeyman/custom-phases` provides `toExportV1` (strips environment-specific fields) and `fromExportV1` (validates header + shape, returns a `CustomAiPhaseCreateInput`). HTTP endpoints sit on the existing custom-phase route registrars and reuse the existing create/validation path. The web UI gets an Export button per phase and an Import button in the user scope only.

**Tech Stack:** TypeScript ESM, Fastify (`@journeyman/custom-phases` routes), Vitest, React (`@journeyman/web`), `@journeyman/core` shared types.

**Spec:** [`docs/superpowers/specs/2026-05-14-custom-phase-export-import-design.md`](../specs/2026-05-14-custom-phase-export-import-design.md).

**Design deviations from the spec (intentional):**

1. **Import endpoint exists on the user route only**, not the org route. The existing routes do not expose a `POST /` create endpoint for org phases — org phases are only produced by `POST /:id/promote` from a user phase. To stay consistent with that pattern, `POST /import` is on the user route; an org admin who wants the imported phase at org scope imports it under their user and then promotes.
2. **Export endpoint exists on both user and org routes** (a user can export both kinds of phases they can see). That matches the existing `GET /:id` read endpoints.
3. **`icon` is included in the export.** It's a definitional field, not environment-specific. The spec listed it implicitly under "pure phase definition"; this plan makes it explicit.

---

## File structure

**Create:**
- `packages/custom-phases/src/export.ts` — pure `toExportV1` / `fromExportV1` + custom error class.
- `packages/custom-phases/src/export.test.ts` — Vitest unit tests for the pure module.

**Modify:**
- `packages/core/src/types/custom-phases.types.ts` — add `CustomPhaseExportV1` type + two exported constants.
- `packages/core/src/index.ts` — re-export the new type and constants.
- `packages/custom-phases/src/index.ts` — re-export `toExportV1`, `fromExportV1`, `CustomPhaseImportError`.
- `packages/custom-phases/src/routes/user-custom-phases.ts` — add `GET /:id/export` and `POST /import`.
- `packages/custom-phases/src/routes/org-custom-phases.ts` — add `GET /:id/export`.
- `packages/web/src/api/customPhases.ts` — add `exportOne`, `importOne` API helpers.
- `packages/web/src/components/custom-phases/CustomPhasesList.tsx` — wire Export button per row; wire Import button (user scope only) with name-conflict prompt.

---

## Task 1: Add the export type and constants to `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/custom-phases.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1.1: Add the type + constants**

Append to the bottom of `packages/core/src/types/custom-phases.types.ts`:

```ts
export const CUSTOM_PHASE_EXPORT_KIND = "journeyman.customPhase" as const;
export const CUSTOM_PHASE_EXPORT_VERSION = 1 as const;

/** Portable subset of CustomAiPhase used for cross-deployment export/import. */
export interface CustomPhaseExportPayloadV1 {
  name: string;
  description: string;
  icon: string | null;
  inputFields: CustomPhaseInputField[];
  outputMode: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate: string;
  defaultTools: CanonicalTool[];
  /** Always [] in exports — cross-system IDs do not resolve. */
  defaultMcpIds: string[];
  /** Always [] in exports — cross-system IDs do not resolve. */
  defaultSkillIds: string[];
  requiresSkills: boolean;
  requiresMcp: boolean;
  slots: SecretSlotDef[];
}

export interface CustomPhaseExportV1 {
  schemaVersion: typeof CUSTOM_PHASE_EXPORT_VERSION;
  kind: typeof CUSTOM_PHASE_EXPORT_KIND;
  exportedAt: string;
  exportedFrom: string;
  phase: CustomPhaseExportPayloadV1;
}
```

You will also need to add the `CanonicalTool` import at the top — open the file and verify the top imports include `CanonicalTool`. It already imports `CanonicalTool` from `./coding-tools.types.ts`, so no change needed.

- [ ] **Step 1.2: Re-export from the package barrel**

Open `packages/core/src/index.ts`. Find the line that re-exports types from `./types/custom-phases.types.ts` (it currently re-exports `CustomAiPhase`, `CustomAiPhaseCreateInput`, etc.). Add `CustomPhaseExportV1`, `CustomPhaseExportPayloadV1` to the type re-export list and add a value re-export for the two constants:

```ts
export {
  CUSTOM_PHASE_EXPORT_KIND,
  CUSTOM_PHASE_EXPORT_VERSION,
} from "./types/custom-phases.types.ts";
```

If the existing block uses `export type {`, leave that for the types and add a separate `export {` block beneath it for the constants.

- [ ] **Step 1.3: Typecheck**

Run: `npm run typecheck -w @journeyman/core`
Expected: passes.

- [ ] **Step 1.4: Commit**

```bash
git add packages/core/src/types/custom-phases.types.ts packages/core/src/index.ts
git commit -m "feat(core): add CustomPhaseExportV1 type and constants"
```

---

## Task 2: Pure `toExportV1` (with failing test first)

**Files:**
- Create: `packages/custom-phases/src/export.test.ts`
- Create: `packages/custom-phases/src/export.ts`

- [ ] **Step 2.1: Write the failing test**

Create `packages/custom-phases/src/export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CustomAiPhase } from "@journeyman/core";
import {
  CUSTOM_PHASE_EXPORT_KIND,
  CUSTOM_PHASE_EXPORT_VERSION,
} from "@journeyman/core";
import { toExportV1 } from "./export.ts";

const samplePhase: CustomAiPhase = {
  id: "phase-123",
  scope: "user",
  userId: "user-1",
  orgId: "org-1",
  name: "Analyze Repo",
  description: "Look at the repo",
  inputFields: [{ name: "repoUrl", type: "string", required: true }],
  outputMode: "structured",
  outputSchema: { type: "object" },
  promptTemplate: "Analyze {{repoUrl}}",
  defaultTools: ["Bash"],
  defaultMcpIds: ["mcp-abc"],
  defaultSkillIds: ["skill-xyz"],
  requiresSkills: false,
  requiresMcp: false,
  slots: [{ name: "GITHUB_TOKEN", description: "GH PAT" }],
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  // `icon` lives on the DB row but is not in the current CustomAiPhase type
  // declaration — cast to access it here. Set it on the literal below via `as any`.
} as any;
(samplePhase as any).icon = "lucide:Sparkles";

describe("toExportV1", () => {
  it("produces a v1 envelope with stripped reference + audit fields", () => {
    const out = toExportV1(samplePhase);

    expect(out.schemaVersion).toBe(CUSTOM_PHASE_EXPORT_VERSION);
    expect(out.kind).toBe(CUSTOM_PHASE_EXPORT_KIND);
    expect(typeof out.exportedAt).toBe("string");
    expect(out.exportedFrom).toBe("journeyman");

    // stripped: id / scope / userId / orgId / createdBy / createdAt / updatedAt
    expect(out.phase).not.toHaveProperty("id");
    expect(out.phase).not.toHaveProperty("scope");
    expect(out.phase).not.toHaveProperty("userId");
    expect(out.phase).not.toHaveProperty("orgId");
    expect(out.phase).not.toHaveProperty("createdBy");
    expect(out.phase).not.toHaveProperty("createdAt");
    expect(out.phase).not.toHaveProperty("updatedAt");

    // cross-system refs are explicitly [] even if the source row had values
    expect(out.phase.defaultMcpIds).toEqual([]);
    expect(out.phase.defaultSkillIds).toEqual([]);

    // carried as-is
    expect(out.phase.name).toBe("Analyze Repo");
    expect(out.phase.description).toBe("Look at the repo");
    expect(out.phase.icon).toBe("lucide:Sparkles");
    expect(out.phase.outputMode).toBe("structured");
    expect(out.phase.outputSchema).toEqual({ type: "object" });
    expect(out.phase.promptTemplate).toBe("Analyze {{repoUrl}}");
    expect(out.phase.defaultTools).toEqual(["Bash"]);
    expect(out.phase.requiresSkills).toBe(false);
    expect(out.phase.requiresMcp).toBe(false);
    expect(out.phase.slots).toEqual([{ name: "GITHUB_TOKEN", description: "GH PAT" }]);
    expect(out.phase.inputFields).toEqual([
      { name: "repoUrl", type: "string", required: true },
    ]);
  });

  it("defaults missing optional fields safely", () => {
    const minimal = {
      ...samplePhase,
      outputSchema: undefined,
    } as any;
    minimal.icon = undefined;
    const out = toExportV1(minimal);
    expect(out.phase.icon).toBeNull();
    expect(out.phase.outputSchema).toBeUndefined();
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `npm test -w @journeyman/custom-phases -- export`
Expected: FAIL — cannot find `./export.ts`.

- [ ] **Step 2.3: Implement `toExportV1`**

Create `packages/custom-phases/src/export.ts`:

```ts
import type { CustomAiPhase } from "@journeyman/core";
import {
  CUSTOM_PHASE_EXPORT_KIND,
  CUSTOM_PHASE_EXPORT_VERSION,
  type CustomPhaseExportV1,
  type CustomPhaseExportPayloadV1,
} from "@journeyman/core";

export function toExportV1(phase: CustomAiPhase): CustomPhaseExportV1 {
  const icon = (phase as { icon?: string | null }).icon ?? null;
  const payload: CustomPhaseExportPayloadV1 = {
    name: phase.name,
    description: phase.description,
    icon,
    inputFields: phase.inputFields,
    outputMode: phase.outputMode,
    outputSchema: phase.outputSchema,
    promptTemplate: phase.promptTemplate,
    defaultTools: phase.defaultTools,
    defaultMcpIds: [],
    defaultSkillIds: [],
    requiresSkills: phase.requiresSkills,
    requiresMcp: phase.requiresMcp,
    slots: phase.slots,
  };
  return {
    schemaVersion: CUSTOM_PHASE_EXPORT_VERSION,
    kind: CUSTOM_PHASE_EXPORT_KIND,
    exportedAt: new Date().toISOString(),
    exportedFrom: "journeyman",
    phase: payload,
  };
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `npm test -w @journeyman/custom-phases -- export`
Expected: PASS, 2 tests.

- [ ] **Step 2.5: Commit**

```bash
git add packages/custom-phases/src/export.ts packages/custom-phases/src/export.test.ts
git commit -m "feat(custom-phases): add pure toExportV1"
```

---

## Task 3: Pure `fromExportV1` + `CustomPhaseImportError`

**Files:**
- Modify: `packages/custom-phases/src/export.test.ts`
- Modify: `packages/custom-phases/src/export.ts`

- [ ] **Step 3.1: Add failing tests for `fromExportV1`**

Append to `packages/custom-phases/src/export.test.ts`:

```ts
import { CustomPhaseImportError, fromExportV1 } from "./export.ts";

describe("fromExportV1", () => {
  const validExport = {
    schemaVersion: 1,
    kind: "journeyman.customPhase",
    exportedAt: "2026-01-01T00:00:00Z",
    exportedFrom: "journeyman",
    phase: {
      name: "P",
      description: "d",
      icon: null,
      inputFields: [],
      outputMode: "text",
      promptTemplate: "go",
      defaultTools: [],
      defaultMcpIds: [],
      defaultSkillIds: [],
      requiresSkills: false,
      requiresMcp: false,
      slots: [],
    },
  };

  it("returns a CustomAiPhaseCreateInput-shaped object on a valid v1 export", () => {
    const out = fromExportV1(validExport);
    expect(out.name).toBe("P");
    expect(out.description).toBe("d");
    expect(out.outputMode).toBe("text");
    expect(out.promptTemplate).toBe("go");
    expect(out.defaultTools).toEqual([]);
    expect(out.defaultMcpIds).toEqual([]);
    expect(out.defaultSkillIds).toEqual([]);
    expect(out.slots).toEqual([]);
    expect(out.inputFields).toEqual([]);
    expect((out as any).icon).toBeNull();
    // scope is supplied by the caller, must not be present on the return
    expect((out as any).scope).toBeUndefined();
  });

  it("strips defaultMcpIds / defaultSkillIds even if they were non-empty", () => {
    const tampered = {
      ...validExport,
      phase: {
        ...validExport.phase,
        defaultMcpIds: ["should-be-dropped"],
        defaultSkillIds: ["also-dropped"],
      },
    };
    const out = fromExportV1(tampered);
    expect(out.defaultMcpIds).toEqual([]);
    expect(out.defaultSkillIds).toEqual([]);
  });

  it("rejects a non-object body", () => {
    expect(() => fromExportV1(null)).toThrow(CustomPhaseImportError);
    expect(() => fromExportV1("nope")).toThrow(CustomPhaseImportError);
    expect(() => fromExportV1(42)).toThrow(CustomPhaseImportError);
  });

  it("rejects the wrong kind", () => {
    expect(() =>
      fromExportV1({ ...validExport, kind: "something-else" }),
    ).toThrow(/kind/);
  });

  it("rejects an unsupported schemaVersion", () => {
    expect(() =>
      fromExportV1({ ...validExport, schemaVersion: 2 }),
    ).toThrow(/schemaVersion/);
  });

  it("rejects a missing phase object", () => {
    const { phase: _drop, ...noPhase } = validExport;
    expect(() => fromExportV1(noPhase)).toThrow(/phase/);
  });
});
```

- [ ] **Step 3.2: Run the tests to verify they fail**

Run: `npm test -w @journeyman/custom-phases -- export`
Expected: FAIL — `fromExportV1` and `CustomPhaseImportError` are not exported.

- [ ] **Step 3.3: Implement `fromExportV1` + `CustomPhaseImportError`**

Append to `packages/custom-phases/src/export.ts`:

```ts
import type { CustomAiPhaseCreateInput } from "@journeyman/core";

export class CustomPhaseImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomPhaseImportError";
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validates the envelope of a v1 custom-phase export and returns a
 * create-input shaped object. Caller supplies `scope` and ownership.
 * Detailed field validation happens in the existing route handler.
 */
export function fromExportV1(raw: unknown): CustomAiPhaseCreateInput & { icon?: string | null } {
  if (!isObject(raw)) {
    throw new CustomPhaseImportError("Import body must be a JSON object");
  }
  if (raw.kind !== CUSTOM_PHASE_EXPORT_KIND) {
    throw new CustomPhaseImportError(
      `Unexpected kind '${String(raw.kind)}'; expected '${CUSTOM_PHASE_EXPORT_KIND}'`,
    );
  }
  if (raw.schemaVersion !== CUSTOM_PHASE_EXPORT_VERSION) {
    throw new CustomPhaseImportError(
      `Unsupported schemaVersion '${String(raw.schemaVersion)}'; this build accepts ${CUSTOM_PHASE_EXPORT_VERSION}`,
    );
  }
  if (!isObject(raw.phase)) {
    throw new CustomPhaseImportError("Import body is missing 'phase' object");
  }
  const p = raw.phase as Record<string, unknown>;

  // Strip cross-system reference IDs defensively, regardless of source.
  return {
    name: p.name as string,
    description: p.description as string | undefined,
    icon: (p.icon ?? null) as string | null,
    inputFields: p.inputFields as CustomAiPhaseCreateInput["inputFields"],
    outputMode: p.outputMode as CustomAiPhaseCreateInput["outputMode"],
    outputSchema: p.outputSchema as CustomAiPhaseCreateInput["outputSchema"],
    promptTemplate: p.promptTemplate as string | undefined,
    defaultTools: p.defaultTools as CustomAiPhaseCreateInput["defaultTools"],
    defaultMcpIds: [],
    defaultSkillIds: [],
    requiresSkills: p.requiresSkills as boolean | undefined,
    requiresMcp: p.requiresMcp as boolean | undefined,
    slots: p.slots as CustomAiPhaseCreateInput["slots"],
  };
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

Run: `npm test -w @journeyman/custom-phases -- export`
Expected: PASS, all tests in the file.

- [ ] **Step 3.5: Re-export from the package**

Open `packages/custom-phases/src/index.ts` and append:

```ts
export { toExportV1, fromExportV1, CustomPhaseImportError } from "./export.ts";
```

- [ ] **Step 3.6: Typecheck**

Run: `npm run typecheck -w @journeyman/custom-phases`
Expected: passes.

- [ ] **Step 3.7: Commit**

```bash
git add packages/custom-phases/src/export.ts packages/custom-phases/src/export.test.ts packages/custom-phases/src/index.ts
git commit -m "feat(custom-phases): add fromExportV1 with envelope validation"
```

---

## Task 4: User-route `GET /:id/export`

**Files:**
- Modify: `packages/custom-phases/src/routes/user-custom-phases.ts`

- [ ] **Step 4.1: Add the export endpoint**

In `packages/custom-phases/src/routes/user-custom-phases.ts`, add a new import at the top:

```ts
import { toExportV1, fromExportV1, CustomPhaseImportError } from "../export.ts";
```

Then, **after** the existing `app.get(".../:id", ...)` block (the one that ends around line 167) and **before** the `app.patch` block, add:

```ts
app.get(
  "/api/orgs/:orgId/users/me/custom-phases/:id/export",
  { preHandler: requireAuth() },
  async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const rec = await getCustomAiPhase(pool, id);
    if (!rec || rec.orgId !== orgId || rec.userId !== ctx.user.id) {
      return reply.code(404).send({ error: "Not found" });
    }
    const payload = toExportV1(rec);
    const slug = rec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "custom-phase";
    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${slug}.json"`);
    return payload;
  },
);
```

- [ ] **Step 4.2: Typecheck**

Run: `npm run typecheck -w @journeyman/custom-phases`
Expected: passes. (The `fromExportV1` / `CustomPhaseImportError` imports are unused for now — TypeScript will not error on that, but if a lint pass fires, switch the import to `import { toExportV1 } from "../export.ts";` for now and re-expand it in Task 5.)

- [ ] **Step 4.3: Commit**

```bash
git add packages/custom-phases/src/routes/user-custom-phases.ts
git commit -m "feat(custom-phases): GET /custom-phases/:id/export for user scope"
```

---

## Task 5: User-route `POST /import`

**Files:**
- Modify: `packages/custom-phases/src/routes/user-custom-phases.ts`

- [ ] **Step 5.1: Add the import endpoint**

If Task 4's import line was narrowed, restore it to:

```ts
import { toExportV1, fromExportV1, CustomPhaseImportError } from "../export.ts";
```

After the `POST /api/orgs/:orgId/users/me/custom-phases` create handler (it currently ends around line 152) and before the next route, add a new import route. To avoid duplicating the create logic, factor the *body* of the existing POST handler into a small inline helper inside the registrar, then have both routes call it.

Concretely:

1. Just above `app.post("/api/orgs/:orgId/users/me/custom-phases", ...)`, add this helper that captures `pool` from the closure:

```ts
async function createUserPhase(
  body: any,
  ctx: NonNullable<typeof req extends never ? never : Parameters<typeof requireAuth>[0]>,
  orgId: string,
  reply: import("fastify").FastifyReply,
) {
  // placeholder — replaced below
}
```

Drop that draft and instead inline the helper *without* the unusable type. Use the working version:

```ts
const handleCreate = async (
  body: any,
  ctx: { user: { id: string }; org: { id: string } },
  orgId: string,
  reply: import("fastify").FastifyReply,
) => {
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
    if (e instanceof ScopeViolationError) {
      reply.code(400).send({ error: formatScopeError(e) });
      return null;
    }
    throw e;
  }
  try {
    const rec = await insertCustomAiPhase(pool, {
      orgId,
      userId: ctx.user.id,
      createdBy: ctx.user.id,
      scope: "user",
      name: body.name,
      description: body.description,
      icon: parseIcon(body.icon) ?? null,
      inputFields: body.inputFields,
      outputMode: body.outputMode,
      outputSchema: body.outputSchema,
      promptTemplate: body.promptTemplate,
      defaultTools: parseDefaultTools(body.defaultTools),
      defaultMcpIds: body.defaultMcpIds,
      defaultSkillIds: body.defaultSkillIds,
      requiresSkills: typeof body.requiresSkills === "boolean" ? body.requiresSkills : false,
      requiresMcp: typeof body.requiresMcp === "boolean" ? body.requiresMcp : false,
      slots: parseSlots(body.slots),
    });
    reply.code(201);
    return rec;
  } catch (err) {
    if (err instanceof DuplicateCustomPhaseError) {
      reply.code(409).send({ error: "name_conflict", message: err.message });
      return null;
    }
    if (err instanceof Error && /^(icon|defaultTools|slots)/.test(err.message)) {
      reply.code(400).send({ error: err.message });
      return null;
    }
    throw err;
  }
};
```

2. Replace the body of the existing `app.post(.../custom-phases", ...)` handler to delegate:

```ts
app.post(
  "/api/orgs/:orgId/users/me/custom-phases",
  { preHandler: requireAuth() },
  async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const result = await handleCreate(req.body as any, ctx, orgId, reply);
    return result; // reply already sent on the error paths
  },
);
```

3. Add the import route immediately after:

```ts
app.post(
  "/api/orgs/:orgId/users/me/custom-phases/import",
  { preHandler: requireAuth() },
  async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const ctx = req.runContext!;
    if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });

    let createInput: ReturnType<typeof fromExportV1>;
    try {
      createInput = fromExportV1(req.body);
    } catch (err) {
      if (err instanceof CustomPhaseImportError) {
        return reply.code(400).send({ error: "invalid_export", message: err.message });
      }
      throw err;
    }

    return await handleCreate(createInput as any, ctx, orgId, reply);
  },
);
```

> **Note on conflict response shape:** the import contract from the spec calls for `409 { error: "name_conflict", existingId }`. The existing `DuplicateCustomPhaseError` message contains the name but not the id, and the existing create route returns `{ error: err.message }`. To keep the contract consistent across create and import, the helper now returns `{ error: "name_conflict", message: <original> }`. We are deliberately not adding `existingId` in this version — it would require a DB lookup-by-name that does not yet exist; the UI can re-list to find the conflicting row. Add `existingId` later if it proves necessary.

- [ ] **Step 5.2: Typecheck**

Run: `npm run typecheck -w @journeyman/custom-phases`
Expected: passes.

- [ ] **Step 5.3: Run the existing custom-phases test suite**

Run: `npm test -w @journeyman/custom-phases`
Expected: all existing tests still pass (this task did not change pure modules).

- [ ] **Step 5.4: Commit**

```bash
git add packages/custom-phases/src/routes/user-custom-phases.ts
git commit -m "feat(custom-phases): POST /custom-phases/import for user scope"
```

---

## Task 6: Org-route `GET /:id/export`

**Files:**
- Modify: `packages/custom-phases/src/routes/org-custom-phases.ts`

- [ ] **Step 6.1: Add the export endpoint**

Add the import at the top of the file:

```ts
import { toExportV1 } from "../export.ts";
import { getCustomAiPhase } from "../db.ts";
```

(`getCustomAiPhase` may already be imported — check the existing imports first and only add what is missing.)

After the existing `app.get("/api/orgs/:orgId/custom-phases", ...)` list handler, add:

```ts
app.get(
  "/api/orgs/:orgId/custom-phases/:id/export",
  { preHandler: requireAuth() },
  async (req, reply) => {
    const { orgId, id } = req.params as { orgId: string; id: string };
    if (req.runContext!.org.id !== orgId) {
      return reply.code(403).send({ error: "Wrong org" });
    }
    const rec = await getCustomAiPhase(pool, id);
    if (!rec || rec.orgId !== orgId || rec.scope !== "org") {
      return reply.code(404).send({ error: "Not found" });
    }
    const payload = toExportV1(rec);
    const slug = rec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "custom-phase";
    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${slug}.json"`);
    return payload;
  },
);
```

- [ ] **Step 6.2: Typecheck**

Run: `npm run typecheck -w @journeyman/custom-phases`
Expected: passes.

- [ ] **Step 6.3: Commit**

```bash
git add packages/custom-phases/src/routes/org-custom-phases.ts
git commit -m "feat(custom-phases): GET /custom-phases/:id/export for org scope"
```

---

## Task 7: Web API helpers

**Files:**
- Modify: `packages/web/src/api/customPhases.ts`

- [ ] **Step 7.1: Add `exportOne` and `importOne`**

Open `packages/web/src/api/customPhases.ts` and add to the `customPhasesApi` object:

```ts
exportOne: async (orgId: string, id: string, scope: "user" | "org") => {
  const url = scope === "user"
    ? `${userBase(orgId)}/${id}/export`
    : `${orgBase(orgId)}/${id}/export`;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
  }
  // Trigger a browser download. Filename comes from Content-Disposition if present.
  const blob = await r.blob();
  const cd = r.headers.get("Content-Disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(cd);
  const filename = m?.[1] ?? "custom-phase.json";
  const a = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
},

importOne: (orgId: string, body: unknown) =>
  fetch(`${userBase(orgId)}/import`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(jsonOrThrow<CustomAiPhase>),
```

- [ ] **Step 7.2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: passes.

- [ ] **Step 7.3: Commit**

```bash
git add packages/web/src/api/customPhases.ts
git commit -m "feat(web): customPhasesApi exportOne/importOne"
```

---

## Task 8: Wire Export + Import in `CustomPhasesList`

**Files:**
- Modify: `packages/web/src/components/custom-phases/CustomPhasesList.tsx`

- [ ] **Step 8.1: Add an `Export` button to each row**

In the `<td>` action cell of each row (currently containing `Edit`, optional `Promote to org`, and `Delete`), insert an Export button **before** Edit:

```tsx
<button
  className={btnGhost}
  onClick={async () => {
    try {
      await customPhasesApi.exportOne(orgId, p.id, scope);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  }}
>
  Export
</button>
```

- [ ] **Step 8.2: Add an Import button (user scope only) next to "New custom phase"**

Find the existing header block:

```tsx
{scope === "user" && (
  <button className={btnPrimary} onClick={() => setEditing({})}>+ New custom phase</button>
)}
```

Replace with:

```tsx
{scope === "user" && (
  <div className="flex items-center gap-2">
    <input
      type="file"
      accept="application/json,.json"
      className="hidden"
      ref={fileInputRef}
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ""; // allow re-importing the same file later
        if (!file) return;
        try {
          const text = await file.text();
          let parsed: unknown;
          try { parsed = JSON.parse(text); }
          catch { throw new Error("File is not valid JSON"); }
          await importOne(parsed);
        } catch (err: any) {
          setError(err?.message ?? String(err));
        }
      }}
    />
    <button className={btnGhost} onClick={() => fileInputRef.current?.click()}>
      Import
    </button>
    <button className={btnPrimary} onClick={() => setEditing({})}>+ New custom phase</button>
  </div>
)}
```

Add the `useRef` import at the top and create the ref + handler in the component body. Near the top of the function, just after the existing `useState` calls, add:

```tsx
const fileInputRef = useRef<HTMLInputElement | null>(null);

const importOne = async (parsed: unknown) => {
  try {
    await customPhasesApi.importOne(orgId, parsed);
    await refresh();
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.includes("name_conflict")) {
      const newName = window.prompt(
        "A custom phase with this name already exists. Enter a new name to import as, or Cancel.",
      );
      if (!newName) return;
      if (typeof parsed === "object" && parsed !== null && "phase" in (parsed as any)) {
        (parsed as any).phase.name = newName;
        await customPhasesApi.importOne(orgId, parsed);
        await refresh();
        return;
      }
    }
    throw err;
  }
};
```

And at the top of the file replace:

```tsx
import { useEffect, useState } from "react";
```

with:

```tsx
import { useEffect, useRef, useState } from "react";
```

- [ ] **Step 8.3: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: passes.

- [ ] **Step 8.4: Manual smoke check**

Start the dev server (`npm run dev` at the repo root, or whichever script the project uses). In the browser:

1. Open *My Custom Phases* — verify the Import button appears next to *+ New custom phase*.
2. Verify each row has *Export*, *Edit*, *Delete* (and *Promote to org* on user rows).
3. Click *Export* on one phase — a `<slug>.json` file should download.
4. Open the downloaded file and confirm: `schemaVersion: 1`, `kind: "journeyman.customPhase"`, `phase.defaultMcpIds: []`, `phase.defaultSkillIds: []`, no `id` / `userId` / `orgId` / `createdAt`.
5. Click *Import* and pick the same file. Expected: name-conflict prompt appears.
6. Enter a new name and confirm. New phase appears in the list with the new name and the same definition.
7. Delete the test row.

- [ ] **Step 8.5: Commit**

```bash
git add packages/web/src/components/custom-phases/CustomPhasesList.tsx
git commit -m "feat(web): Export/Import buttons on custom phases list"
```

---

## Task 9: Final verification

- [ ] **Step 9.1: Full typecheck**

Run: `npm run typecheck`
Expected: passes for all workspaces.

- [ ] **Step 9.2: Full test run**

Run: `npm test -w @journeyman/custom-phases`
Expected: passes, including the two new test blocks (`toExportV1`, `fromExportV1`).

- [ ] **Step 9.3: Git status sanity check**

Run: `git status`
Expected: clean working tree on the feature branch.

---

## Self-review notes

- **Spec coverage:** export shape (Task 1), `toExportV1` (Task 2), `fromExportV1` + envelope validation (Task 3), `GET /:id/export` on both routes (Tasks 4 + 6), `POST /import` on user route (Task 5), reuse of existing create validation via `handleCreate` (Task 5), `409 name_conflict` (Task 5), UI export/import + rename-on-conflict prompt (Task 8). The two deliberate deviations from the spec (import on user route only; `existingId` omitted from the 409 body for now) are called out in the "Design deviations" block at the top.
- **Stripped fields covered:** `id`, `scope`, `userId`, `orgId`, `createdBy`, `createdAt`, `updatedAt` — never copied into the export payload (Task 2 test asserts each one). `defaultMcpIds` / `defaultSkillIds` set to `[]` on export *and* on import (defensive — Task 2 + Task 3 tests).
- **Out of scope respected:** no YAML, no bulk export, no embedding MCPs/Skills, no v2 migration.
- **Type names checked:** `CustomPhaseExportV1`, `CustomPhaseExportPayloadV1`, `CUSTOM_PHASE_EXPORT_KIND`, `CUSTOM_PHASE_EXPORT_VERSION`, `toExportV1`, `fromExportV1`, `CustomPhaseImportError`, `handleCreate`, `customPhasesApi.exportOne`, `customPhasesApi.importOne` — used consistently across all tasks.
