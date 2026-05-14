# Custom Phase Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let custom-phase authors pick an icon (curated Lucide set, ~40 icons) per phase. Render it everywhere a phase is shown. Schema is forward-compatible with uploaded raster icons later — no second migration.

**Architecture:** Single nullable `icon TEXT` column on `jm_custom_ai_phases`. Value is a scheme-prefixed string: `lucide:<Name>` today, reserved `data:image/...` for future uploads. Server validates against an allowlist exported from `@journeyman/core`. Rendering is centralised in `resolvePhaseIcon(icon)` in `@journeyman/flow-editor`, which maps `lucide:*` → Lucide React component, `data:*` → `<img>`, anything else → plain text (preserves built-in `■ ? × ⊞` glyphs).

**Tech Stack:** TypeScript, React, Lucide React (already a dep), Fastify, PostgreSQL, Node test runner / vitest.

**Spec:** [docs/superpowers/specs/2026-05-14-custom-phase-icons-design.md](../specs/2026-05-14-custom-phase-icons-design.md)

---

## File Plan

**New:**
- `packages/core/src/types/custom-phase-icons.ts` — `CUSTOM_PHASE_ICON_NAMES` constant (~40 strings), `DEFAULT_CUSTOM_PHASE_ICON_ID = "lucide:Puzzle"`, `isValidCustomPhaseIcon(value)` validator.
- `packages/flow-editor/src/icons/custom-phase-icons.tsx` — `CUSTOM_PHASE_ICON_COMPONENTS: Record<string, LucideIcon>` and re-export of the names constant.
- `packages/flow-editor/src/icons/resolve.tsx` — `resolvePhaseIcon(icon, opts?)` helper.
- `packages/web/src/components/custom-phases/IconPicker.tsx` — grid icon picker.
- `packages/migrations/src/sql/024_custom_phase_icon.sql` — adds `icon TEXT NULL`.

**Modify:**
- `packages/core/src/index.ts` — export the new icons module as value (not just type).
- `packages/core/src/types/custom-phases.types.ts` — add `icon?: string | null` to `CustomAiPhase` and `CustomAiPhaseCreateInput`.
- `packages/custom-phases/src/db.ts` — read/write `icon` in `rowToPhase`, `insertCustomAiPhase`, `updateCustomAiPhase`.
- `packages/custom-phases/src/routes/user-custom-phases.ts` — validate + pass through `icon` on POST/PATCH.
- `packages/custom-phases/src/routes/org-custom-phases.ts` — validate + pass through `icon` on PATCH.
- `packages/flow-editor/src/phase-definition.ts` — comment-only: document that `icon` may be a scheme-prefixed string.
- `packages/flow-editor/src/palette/PaletteItem.tsx` — replace `{entry.icon}` with `resolvePhaseIcon(entry.icon)`.
- `packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts` — read `p.icon ?? DEFAULT_CUSTOM_PHASE_ICON_ID`.
- `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx` — add icon state + render `IconPicker` in the Definition tab + send `icon` in the save payload.

---

## Task 1: Add icon constants and validator in `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/custom-phase-icons.ts`
- Create: `packages/core/src/types/custom-phase-icons.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/custom-phase-icons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CUSTOM_PHASE_ICON_NAMES,
  DEFAULT_CUSTOM_PHASE_ICON_ID,
  isValidCustomPhaseIcon,
} from "./custom-phase-icons.ts";

describe("custom-phase-icons", () => {
  it("ships a non-empty curated list", () => {
    expect(CUSTOM_PHASE_ICON_NAMES.length).toBeGreaterThanOrEqual(30);
    expect(CUSTOM_PHASE_ICON_NAMES.length).toBeLessThanOrEqual(60);
  });

  it("contains no duplicates", () => {
    const set = new Set(CUSTOM_PHASE_ICON_NAMES);
    expect(set.size).toBe(CUSTOM_PHASE_ICON_NAMES.length);
  });

  it("default is in the allowlist", () => {
    const name = DEFAULT_CUSTOM_PHASE_ICON_ID.replace(/^lucide:/, "");
    expect(CUSTOM_PHASE_ICON_NAMES).toContain(name);
  });

  it("accepts null and undefined as 'use default'", () => {
    expect(isValidCustomPhaseIcon(null)).toBe(true);
    expect(isValidCustomPhaseIcon(undefined)).toBe(true);
  });

  it("accepts a lucide id from the allowlist", () => {
    expect(isValidCustomPhaseIcon(`lucide:${CUSTOM_PHASE_ICON_NAMES[0]}`)).toBe(true);
  });

  it("rejects an unknown lucide name", () => {
    expect(isValidCustomPhaseIcon("lucide:NotARealIconName_xyz")).toBe(false);
  });

  it("rejects a non-string non-null value", () => {
    expect(isValidCustomPhaseIcon(42)).toBe(false);
    expect(isValidCustomPhaseIcon({})).toBe(false);
  });

  it("rejects an unknown scheme", () => {
    expect(isValidCustomPhaseIcon("emoji:🚀")).toBe(false);
    expect(isValidCustomPhaseIcon("http://example.com/x.png")).toBe(false);
  });

  it("rejects data: URLs for now (uploads not yet supported)", () => {
    expect(isValidCustomPhaseIcon("data:image/png;base64,aaaa")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/types/custom-phase-icons.test.ts`
Expected: FAIL — cannot resolve module `./custom-phase-icons.ts`.

- [ ] **Step 3: Implement the constants and validator**

Create `packages/core/src/types/custom-phase-icons.ts`:

```ts
/**
 * Allowlist of Lucide icon names available to custom phases.
 * The same list is rendered in the picker (flow-editor) and validated on the
 * server. Kept here so both layers can import it without a cyclic dependency.
 *
 * Adding/removing a name: also confirm the icon exists in `lucide-react@^0.400`
 * (used by flow-editor, web, run-viewer).
 */
export const CUSTOM_PHASE_ICON_NAMES = [
  "Bot", "Brain", "Sparkles", "Wand2",
  "Code2", "Terminal", "GitBranch", "GitMerge",
  "GitPullRequest", "Bug", "Hammer", "Wrench",
  "Cog", "Workflow", "Boxes", "Package",
  "FileText", "FileCode", "ClipboardCheck", "ListChecks",
  "Search", "MessageSquare", "Bell", "Mail",
  "Cpu", "Database", "Cloud", "Shield",
  "Lock", "Key", "Rocket", "FlaskConical",
  "Microscope", "BookOpen", "Pencil", "PenLine",
  "Eye", "BarChart3", "Activity", "Puzzle",
] as const;

export type CustomPhaseIconName = (typeof CUSTOM_PHASE_ICON_NAMES)[number];

export const DEFAULT_CUSTOM_PHASE_ICON_ID = "lucide:Puzzle";

/**
 * Validate an `icon` value as accepted by the custom-phases API.
 * `null` / `undefined` → valid (means "use default" on read).
 * `lucide:<Name>` → valid if `<Name>` is in the allowlist.
 * Anything else → invalid for now. (`data:image/...` will be allowed later
 * when raster uploads ship.)
 */
export function isValidCustomPhaseIcon(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("lucide:")) {
    const name = value.slice("lucide:".length);
    return (CUSTOM_PHASE_ICON_NAMES as readonly string[]).includes(name);
  }
  return false;
}
```

- [ ] **Step 4: Export from core's index**

Edit `packages/core/src/index.ts` — add this line after the existing `export type * from "./types/custom-phases.types.ts";`:

```ts
export * from "./types/custom-phase-icons.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/types/custom-phase-icons.test.ts`
Expected: PASS (all 9 tests green).

- [ ] **Step 6: Typecheck the whole repo**

Run: `npm run typecheck`
Expected: passes (no new errors introduced).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/custom-phase-icons.ts packages/core/src/types/custom-phase-icons.test.ts packages/core/src/index.ts
git commit -m "feat(core): curated custom-phase icon allowlist + validator"
```

---

## Task 2: Add `icon` field to `CustomAiPhase` types

**Files:**
- Modify: `packages/core/src/types/custom-phases.types.ts`

- [ ] **Step 1: Edit the type**

In `packages/core/src/types/custom-phases.types.ts`, inside `CustomAiPhase`, add `icon` immediately after `description`:

```ts
export interface CustomAiPhase {
  id: string;
  scope: CustomPhaseScope;
  userId?: string;
  orgId: string;
  name: string;
  description: string;
  /**
   * Icon shown in the palette and on the canvas. Scheme-prefixed string:
   *   "lucide:<Name>" — a name from CUSTOM_PHASE_ICON_NAMES (today).
   *   "data:image/..." — inline uploaded raster (future; rejected today).
   *   null/undefined — render DEFAULT_CUSTOM_PHASE_ICON_ID.
   */
  icon?: string | null;
  inputFields: CustomPhaseInputField[];
  // …unchanged below…
  outputMode: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate: string;
  defaultTools: CanonicalTool[];
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  requiresSkills: boolean;
  requiresMcp: boolean;
  slots: SecretSlotDef[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

Also add `icon` to `CustomAiPhaseCreateInput`, after `description`:

```ts
export interface CustomAiPhaseCreateInput {
  scope: CustomPhaseScope;
  name: string;
  description?: string;
  icon?: string | null;
  inputFields?: CustomPhaseInputField[];
  // …unchanged below…
}
```

(`CustomAiPhaseUpdateInput` is `Partial<Omit<CustomAiPhaseCreateInput, "scope">>` — it picks up `icon` automatically.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/custom-phases.types.ts
git commit -m "feat(core): add CustomAiPhase.icon field"
```

---

## Task 3: Database migration

**Files:**
- Create: `packages/migrations/src/sql/024_custom_phase_icon.sql`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/024_custom_phase_icon.sql`:

```sql
-- 024: per-phase icon for custom AI phases.
-- NULL means "use the default icon" (resolved at render time).
ALTER TABLE jm_custom_ai_phases
  ADD COLUMN icon TEXT NULL;
```

- [ ] **Step 2: Run the migration against your local dev DB**

Use the project's existing migration runner. From the repo root:

```bash
npm run -w @journeyman/migrations migrate
```

Expected: prints `024_custom_phase_icon` as applied, exits 0.

If the runner has a different script name, inspect `packages/migrations/package.json` for the right command — do **not** run raw `psql` to apply it.

- [ ] **Step 3: Verify the column exists**

```bash
psql "$DATABASE_URL" -c "\d jm_custom_ai_phases" | grep icon
```

Expected: a line like `icon | text | | |`.

- [ ] **Step 4: Commit**

```bash
git add packages/migrations/src/sql/024_custom_phase_icon.sql
git commit -m "feat(db): jm_custom_ai_phases.icon column"
```

---

## Task 4: Persist `icon` in the DB layer

**Files:**
- Modify: `packages/custom-phases/src/db.ts`

- [ ] **Step 1: Update `rowToPhase` to read `icon`**

In `packages/custom-phases/src/db.ts`, change `rowToPhase` so the returned object includes `icon`:

```ts
function rowToPhase(r: any): CustomAiPhase {
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    name: r.name,
    description: r.description ?? "",
    icon: r.icon ?? null,
    inputFields: r.input_fields ?? [],
    outputMode: r.output_mode,
    outputSchema: r.output_schema ?? undefined,
    promptTemplate: r.prompt_template ?? "",
    defaultTools: Array.isArray(r.default_tools) ? r.default_tools : [],
    defaultMcpIds: r.default_mcp_ids ?? [],
    defaultSkillIds: r.default_skill_ids ?? [],
    requiresSkills: r.requires_skills ?? false,
    requiresMcp: r.requires_mcp ?? false,
    slots: Array.isArray(r.slots) ? r.slots : [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
```

- [ ] **Step 2: Update `insertCustomAiPhase` to write `icon`**

Replace the INSERT statement and its parameter array. The new statement adds `icon` as the second column (right after `description`) and bumps every later positional parameter by one:

```ts
export async function insertCustomAiPhase(
  pool: Pool,
  input: CustomAiPhaseCreateInput & { orgId: string; userId: string | null; createdBy: string },
): Promise<CustomAiPhase> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_custom_ai_phases
         (scope, user_id, org_id, name, description, icon,
          input_fields, output_mode, output_schema,
          prompt_template, default_tools,
          default_mcp_ids, default_skill_ids,
          slots,
          requires_skills,
          requires_mcp,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        input.scope,
        input.userId,
        input.orgId,
        input.name,
        input.description ?? "",
        input.icon ?? null,
        JSON.stringify(input.inputFields ?? []),
        input.outputMode ?? "none",
        input.outputSchema ? JSON.stringify(input.outputSchema) : null,
        input.promptTemplate ?? "",
        JSON.stringify(input.defaultTools ?? []),
        JSON.stringify(input.defaultMcpIds ?? []),
        JSON.stringify(input.defaultSkillIds ?? []),
        JSON.stringify(input.slots ?? []),
        input.requiresSkills ?? false,
        input.requiresMcp ?? false,
        input.createdBy,
      ],
    );
    return rowToPhase(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateCustomPhaseError(input.name);
    throw err;
  }
}
```

- [ ] **Step 3: Update `updateCustomAiPhase` to patch `icon`**

Inside `updateCustomAiPhase`, immediately after the `description` push line, add an `icon` push line:

```ts
  if (patch.name !== undefined)            push("name", patch.name);
  if (patch.description !== undefined)     push("description", patch.description);
  if (patch.icon !== undefined)            push("icon", patch.icon);
  if (patch.inputFields !== undefined)     push("input_fields", JSON.stringify(patch.inputFields));
```

(Allow `null` through; `push("icon", null)` is valid — it resets to default.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/custom-phases/src/db.ts
git commit -m "feat(custom-phases): persist icon column"
```

---

## Task 5: Server-side validation in the routes

**Files:**
- Modify: `packages/custom-phases/src/routes/user-custom-phases.ts`
- Modify: `packages/custom-phases/src/routes/org-custom-phases.ts`

- [ ] **Step 1: Update user-custom-phases.ts**

In `packages/custom-phases/src/routes/user-custom-phases.ts`:

1. Add `isValidCustomPhaseIcon` to the `@journeyman/core` import (top of file):

```ts
import {
  CANONICAL_TOOLS, isCanonicalTool, isValidCustomPhaseIcon,
  type CanonicalTool, type SecretSlotDef,
} from "@journeyman/core";
```

2. Add a parser near `parseDefaultTools`:

```ts
function parseIcon(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined; // caller skips the field
  if (!isValidCustomPhaseIcon(raw)) {
    throw new Error("icon must be null or 'lucide:<AllowlistedName>'");
  }
  return (raw ?? null) as string | null;
}
```

3. In the POST handler, after the `try { const rec = await insertCustomAiPhase(...)` block, add `icon` to the insert payload. Replace the existing `insertCustomAiPhase` call with:

```ts
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
```

4. In the PATCH handler, extend the `patch` builder so `icon` is validated when present. Replace the `const patch = { ... }` block with:

```ts
        const patchBody = req.body as any;
        const patch = {
          ...patchBody,
          ...(patchBody?.icon !== undefined
            ? { icon: parseIcon(patchBody.icon) }
            : {}),
          ...(patchBody?.defaultTools !== undefined
            ? { defaultTools: parseDefaultTools(patchBody.defaultTools) }
            : {}),
          ...(patchBody?.slots !== undefined
            ? { slots: parseSlots(patchBody.slots) }
            : {}),
        };
```

A thrown error from `parseIcon` here will surface as a 500 unless caught — wrap the body of the PATCH handler the same way POST is structured. The existing `try/catch` for `DuplicateCustomPhaseError` already wraps `updateCustomAiPhase`. Extend that outer try to also map plain `Error` from `parseIcon`/`parseSlots`/`parseDefaultTools` to a 400. Replace the inner try wrap:

```ts
      try {
        const patchBody = req.body as any;
        const patch = {
          ...patchBody,
          ...(patchBody?.icon !== undefined
            ? { icon: parseIcon(patchBody.icon) }
            : {}),
          ...(patchBody?.defaultTools !== undefined
            ? { defaultTools: parseDefaultTools(patchBody.defaultTools) }
            : {}),
          ...(patchBody?.slots !== undefined
            ? { slots: parseSlots(patchBody.slots) }
            : {}),
        };
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
        return await updateCustomAiPhase(pool, id, patch);
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        if (err instanceof Error && /icon must be|defaultTools|slots/.test(err.message)) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
```

(The same 400-mapping should already apply to `parseSlots` / `parseDefaultTools` for consistency; we're adding `icon` to that family.)

Apply the same outer-try 400 mapping inside the POST handler if it isn't already there: wrap `parseDefaultTools(body.defaultTools)` and `parseSlots(body.slots)` and `parseIcon(body.icon)` in a try/catch that returns 400 on `Error`. The minimal change is to put `const icon = parseIcon(body.icon) ?? null;` before the insert call inside the existing `try { … } catch (err) { if (err instanceof DuplicateCustomPhaseError) … }` block, and add the same `if (err instanceof Error && /icon must be|…/) return 400` branch.

- [ ] **Step 2: Update org-custom-phases.ts (PATCH only — there's no POST here)**

In `packages/custom-phases/src/routes/org-custom-phases.ts`:

1. Add `isValidCustomPhaseIcon` to the import:

```ts
import {
  CANONICAL_TOOLS, isCanonicalTool, isValidCustomPhaseIcon,
  type CanonicalTool, type SecretSlotDef,
} from "@journeyman/core";
```

2. Add `parseIcon` (same body as in Task 5 Step 1).

3. In the PATCH handler, mirror the user-routes change:

```ts
      try {
        const patchBody = req.body as any;
        const patch = {
          ...patchBody,
          ...(patchBody?.icon !== undefined
            ? { icon: parseIcon(patchBody.icon) }
            : {}),
          ...(patchBody?.defaultTools !== undefined
            ? { defaultTools: parseDefaultTools(patchBody.defaultTools) }
            : {}),
          ...(patchBody?.slots !== undefined
            ? { slots: parseSlots(patchBody.slots) }
            : {}),
        };
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
        return await updateCustomAiPhase(pool, id, patch);
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        if (err instanceof Error && /icon must be|defaultTools|slots/.test(err.message)) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Smoke-test via curl (with the dev server running)**

Find an existing user-scoped phase id; then:

```bash
# Valid update:
curl -sS -X PATCH "http://localhost:3000/api/orgs/$ORG_ID/users/me/custom-phases/$ID" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d '{"icon":"lucide:Bot"}'
# Expected: 200 with the phase body, icon === "lucide:Bot"

# Invalid update:
curl -sS -X PATCH "http://localhost:3000/api/orgs/$ORG_ID/users/me/custom-phases/$ID" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d '{"icon":"lucide:NotARealIcon"}'
# Expected: 400 with {"error":"icon must be ..."}

# Reset to default:
curl -sS -X PATCH "http://localhost:3000/api/orgs/$ORG_ID/users/me/custom-phases/$ID" \
  -H 'content-type: application/json' \
  -b "$COOKIE_JAR" \
  -d '{"icon":null}'
# Expected: 200 with icon === null
```

(If you cannot run a server in your environment, skip the smoke test and rely on the unit test in Task 1 plus typecheck.)

- [ ] **Step 5: Commit**

```bash
git add packages/custom-phases/src/routes/user-custom-phases.ts packages/custom-phases/src/routes/org-custom-phases.ts
git commit -m "feat(custom-phases): validate and persist icon on create/update"
```

---

## Task 6: Icon component map in flow-editor

**Files:**
- Create: `packages/flow-editor/src/icons/custom-phase-icons.tsx`

- [ ] **Step 1: Implement the component map**

Create `packages/flow-editor/src/icons/custom-phase-icons.tsx`:

```tsx
import type { LucideIcon } from "lucide-react";
import {
  Bot, Brain, Sparkles, Wand2,
  Code2, Terminal, GitBranch, GitMerge,
  GitPullRequest, Bug, Hammer, Wrench,
  Cog, Workflow, Boxes, Package,
  FileText, FileCode, ClipboardCheck, ListChecks,
  Search, MessageSquare, Bell, Mail,
  Cpu, Database, Cloud, Shield,
  Lock, Key, Rocket, FlaskConical,
  Microscope, BookOpen, Pencil, PenLine,
  Eye, BarChart3, Activity, Puzzle,
} from "lucide-react";

import { CUSTOM_PHASE_ICON_NAMES } from "@journeyman/core";

/**
 * Lucide component for each name in CUSTOM_PHASE_ICON_NAMES.
 * Must stay in sync with that allowlist; the test in this directory enforces it.
 */
export const CUSTOM_PHASE_ICON_COMPONENTS: Record<string, LucideIcon> = {
  Bot, Brain, Sparkles, Wand2,
  Code2, Terminal, GitBranch, GitMerge,
  GitPullRequest, Bug, Hammer, Wrench,
  Cog, Workflow, Boxes, Package,
  FileText, FileCode, ClipboardCheck, ListChecks,
  Search, MessageSquare, Bell, Mail,
  Cpu, Database, Cloud, Shield,
  Lock, Key, Rocket, FlaskConical,
  Microscope, BookOpen, Pencil, PenLine,
  Eye, BarChart3, Activity, Puzzle,
};

export { CUSTOM_PHASE_ICON_NAMES };
```

- [ ] **Step 2: Add a parity test**

Create `packages/flow-editor/src/icons/custom-phase-icons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CUSTOM_PHASE_ICON_NAMES } from "@journeyman/core";
import { CUSTOM_PHASE_ICON_COMPONENTS } from "./custom-phase-icons.tsx";

describe("custom-phase icon components", () => {
  it("has a component for every allowlisted name", () => {
    for (const name of CUSTOM_PHASE_ICON_NAMES) {
      expect(CUSTOM_PHASE_ICON_COMPONENTS[name], `missing component: ${name}`).toBeDefined();
    }
  });

  it("has no extra components beyond the allowlist", () => {
    const extras = Object.keys(CUSTOM_PHASE_ICON_COMPONENTS).filter(
      (k) => !(CUSTOM_PHASE_ICON_NAMES as readonly string[]).includes(k),
    );
    expect(extras).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the parity test**

Run: `cd packages/flow-editor && npx vitest run src/icons/custom-phase-icons.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/flow-editor/src/icons/custom-phase-icons.tsx packages/flow-editor/src/icons/custom-phase-icons.test.ts
git commit -m "feat(flow-editor): map curated Lucide icons for custom phases"
```

---

## Task 7: `resolvePhaseIcon` helper

**Files:**
- Create: `packages/flow-editor/src/icons/resolve.tsx`
- Create: `packages/flow-editor/src/icons/resolve.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/icons/resolve.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resolvePhaseIcon } from "./resolve.tsx";

describe("resolvePhaseIcon", () => {
  it("renders a Lucide component for a valid lucide:<Name>", () => {
    const html = renderToStaticMarkup(<>{resolvePhaseIcon("lucide:Bot")}</>);
    expect(html).toContain("<svg"); // Lucide renders an <svg>
  });

  it("renders a glyph for unknown lucide names (fallback to raw text)", () => {
    const html = renderToStaticMarkup(<>{resolvePhaseIcon("lucide:NotReal")}</>);
    expect(html).toContain("lucide:NotReal");
  });

  it("renders an <img> for data: URLs", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const html = renderToStaticMarkup(<>{resolvePhaseIcon(dataUrl)}</>);
    expect(html).toContain(`<img`);
    expect(html).toContain(`src="${dataUrl}"`);
  });

  it("renders plain glyphs unchanged (built-in phases)", () => {
    const html = renderToStaticMarkup(<>{resolvePhaseIcon("■")}</>);
    expect(html).toContain("■");
  });

  it("renders the default when icon is null", () => {
    const html = renderToStaticMarkup(<>{resolvePhaseIcon(null)}</>);
    expect(html).toContain("<svg");
  });

  it("renders the default when icon is undefined", () => {
    const html = renderToStaticMarkup(<>{resolvePhaseIcon(undefined)}</>);
    expect(html).toContain("<svg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/flow-editor && npx vitest run src/icons/resolve.test.tsx`
Expected: FAIL — cannot resolve `./resolve.tsx`.

- [ ] **Step 3: Implement `resolvePhaseIcon`**

Create `packages/flow-editor/src/icons/resolve.tsx`:

```tsx
import type { ReactNode } from "react";
import { DEFAULT_CUSTOM_PHASE_ICON_ID } from "@journeyman/core";
import { CUSTOM_PHASE_ICON_COMPONENTS } from "./custom-phase-icons.tsx";

export interface ResolvePhaseIconOptions {
  /** Pixel size for Lucide or <img> rendering. Default 16. */
  size?: number;
  className?: string;
}

/**
 * Render a phase icon value to a ReactNode.
 *
 *   "lucide:<Name>" → a Lucide component (if in the allowlist) else raw text.
 *   "data:image/..." → an <img> tag.
 *   anything else (e.g. "■", "?", "⊞") → rendered as plain text.
 *   null / undefined → DEFAULT_CUSTOM_PHASE_ICON_ID.
 *
 * Centralising this means the wire format of `PhaseDefinition.icon` stays a
 * single string, and we can add new schemes (e.g. data: uploads) without
 * touching every render site.
 */
export function resolvePhaseIcon(
  icon: string | null | undefined,
  opts: ResolvePhaseIconOptions = {},
): ReactNode {
  const size = opts.size ?? 16;
  const id = icon ?? DEFAULT_CUSTOM_PHASE_ICON_ID;

  if (id.startsWith("lucide:")) {
    const name = id.slice("lucide:".length);
    const Cmp = CUSTOM_PHASE_ICON_COMPONENTS[name];
    if (Cmp) return <Cmp size={size} className={opts.className} />;
    return <>{id}</>;
  }

  if (id.startsWith("data:image/")) {
    return (
      <img
        src={id}
        alt=""
        width={size}
        height={size}
        className={opts.className}
        style={{ objectFit: "contain" }}
      />
    );
  }

  return <>{id}</>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/flow-editor && npx vitest run src/icons/resolve.test.tsx`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/icons/resolve.tsx packages/flow-editor/src/icons/resolve.test.tsx
git commit -m "feat(flow-editor): resolvePhaseIcon for scheme-prefixed icon values"
```

---

## Task 8: Wire `resolvePhaseIcon` into the palette

**Files:**
- Modify: `packages/flow-editor/src/palette/PaletteItem.tsx`

- [ ] **Step 1: Read the current PaletteItem render**

Open `packages/flow-editor/src/palette/PaletteItem.tsx`. The icon is rendered around line 60 as:

```tsx
<div className="je-palette__icon" style={{ background: entry.color }}>{entry.icon}</div>
```

- [ ] **Step 2: Replace the icon site**

At the top of the file, add:

```tsx
import { resolvePhaseIcon } from "../icons/resolve.tsx";
```

Then change the icon line to:

```tsx
<div className="je-palette__icon" style={{ background: entry.color }}>
  {resolvePhaseIcon(entry.icon, { size: 16, className: "je-palette__icon-svg" })}
</div>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Visual check**

Start the dev server (typical for this repo — confirm the script in the root `package.json`):

```bash
npm run dev
```

Navigate to the flow editor, open the palette. Built-in phases must still show their glyphs (`■`, `?`, `×`). Existing custom phases should now show the default puzzle icon (because no rows have `icon` set yet).

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/palette/PaletteItem.tsx
git commit -m "feat(flow-editor): render palette icons via resolvePhaseIcon"
```

---

## Task 9: Use the per-phase icon in the synthesizer

**Files:**
- Modify: `packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts`

- [ ] **Step 1: Read the current `buildSyntheticPhase`**

The line `icon: "🧩",` (around line 42) is the hardcoded default.

- [ ] **Step 2: Replace it**

Add to the imports at the top:

```ts
import { DEFAULT_CUSTOM_PHASE_ICON_ID } from "@journeyman/core";
```

Change the icon line in `buildSyntheticPhase`:

```ts
    icon: p.icon ?? DEFAULT_CUSTOM_PHASE_ICON_ID,
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Visual check**

In the dev server, the existing custom phases should now show the Lucide `Puzzle` icon (not the `🧩` emoji). Once Task 10 lands and a user picks a different icon, the palette tile will reflect it after a refresh.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts
git commit -m "feat(web): per-phase icon in custom-phase palette entries"
```

---

## Task 10: Icon picker UI in the edit modal

**Files:**
- Create: `packages/web/src/components/custom-phases/IconPicker.tsx`
- Modify: `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx`

- [ ] **Step 1: Create the picker**

Create `packages/web/src/components/custom-phases/IconPicker.tsx`:

```tsx
import {
  CUSTOM_PHASE_ICON_NAMES,
  DEFAULT_CUSTOM_PHASE_ICON_ID,
} from "@journeyman/core";
import { resolvePhaseIcon } from "@journeyman/flow-editor";

export interface IconPickerProps {
  /** Current icon id; `null` means "use default" and the default tile is highlighted. */
  value: string | null;
  onChange: (next: string | null) => void;
}

/**
 * Flat grid of curated Lucide icons. Clicking a tile sets `lucide:<Name>`.
 * "Reset to default" sends `null`, which resolves to DEFAULT_CUSTOM_PHASE_ICON_ID
 * at render time.
 *
 * Future: a file-input + preview will live alongside the grid for uploaded
 * raster icons. The resolver already handles `data:image/...` values.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const selectedId = value ?? DEFAULT_CUSTOM_PHASE_ICON_ID;
  const defaultName = DEFAULT_CUSTOM_PHASE_ICON_ID.replace(/^lucide:/, "");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-100">
          {resolvePhaseIcon(selectedId, { size: 20 })}
        </div>
        <div className="text-xs text-slate-400">
          Current: <code className="text-slate-200">{selectedId}</code>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto text-xs text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
        >
          Reset to default
        </button>
      </div>
      <div
        role="radiogroup"
        aria-label="Phase icon"
        className="grid grid-cols-8 gap-2"
      >
        {CUSTOM_PHASE_ICON_NAMES.map((name) => {
          const id = `lucide:${name}`;
          const isSelected = id === selectedId;
          const isDefault = name === defaultName && value === null;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={isSelected}
              title={name}
              onClick={() => onChange(id)}
              className={
                "h-9 w-9 flex items-center justify-center rounded-md border transition " +
                (isSelected
                  ? "bg-indigo-500/20 border-indigo-400 text-indigo-100"
                  : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-slate-100") +
                (isDefault && !isSelected ? " ring-1 ring-slate-700" : "")
              }
            >
              {resolvePhaseIcon(id, { size: 18 })}
            </button>
          );
        })}
      </div>
      {/* TODO(custom-phase-icon-uploads):
          When uploads ship, render a file-input + preview below this grid.
          The resolver already supports data:image/... values, so storage and
          rendering are wired — only this picker needs the new affordance. */}
    </div>
  );
}
```

- [ ] **Step 2: Confirm `resolvePhaseIcon` is exported from `@journeyman/flow-editor`**

Check `packages/flow-editor/src/index.ts`. If `resolvePhaseIcon` is not exported, add this line near the other exports:

```ts
export { resolvePhaseIcon } from "./icons/resolve.tsx";
```

Also export the constants for any future consumers:

```ts
export { CUSTOM_PHASE_ICON_COMPONENTS } from "./icons/custom-phase-icons.tsx";
```

- [ ] **Step 3: Wire the picker into `EditCustomPhaseModal`**

Open `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx`.

1. Import the picker (add to the existing imports near the top):

```tsx
import { IconPicker } from "./IconPicker.tsx";
```

2. Add the icon state next to the other `useState` calls (right after `description`):

```tsx
const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
```

3. In the `submit` function, include `icon` in the payload sent to `onSave`. Replace the existing `onSave({...})` call body:

```tsx
      await onSave({
        scope,
        name, description,
        icon,
        inputFields,
        outputMode,
        outputSchema: outputMode === "structured" ? outputSchema : undefined,
        promptTemplate,
        defaultTools,
        defaultMcpIds: initial?.defaultMcpIds ?? [],
        defaultSkillIds: initial?.defaultSkillIds ?? [],
        requiresSkills,
        requiresMcp,
        slots,
      });
```

4. Render the picker inside the Definition tab. Find the `{activeTab === "definition" && (` block and insert a new field between the Description textarea and the `requiresSkills` checkbox group:

```tsx
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-300">Icon</div>
                  <IconPicker value={icon} onChange={setIcon} />
                </div>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Visual check end-to-end**

1. Start the dev server.
2. Open `/admin/custom-phases` (or `/custom-phases` for user-scope) and edit any phase.
3. In the Definition tab, the Icon picker grid appears with the default Puzzle ringed.
4. Click `Bot`. Save.
5. Reload the flow editor. The phase tile in the palette now shows the Bot icon.
6. Re-open the edit modal: the Bot tile is highlighted.
7. Click "Reset to default", save, reload — palette goes back to Puzzle.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/custom-phases/IconPicker.tsx packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx packages/flow-editor/src/index.ts
git commit -m "feat(web): icon picker in custom-phase edit modal"
```

---

## Task 11: Final sweep — type + tests + manual smoke

- [ ] **Step 1: Repo-wide typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 2: Run all package tests**

Run (from repo root): `npm test --workspaces --if-present`
Expected: all green. New tests added: `core/.../custom-phase-icons.test.ts`, `flow-editor/.../custom-phase-icons.test.ts`, `flow-editor/.../resolve.test.tsx`.

- [ ] **Step 3: Grep for any stale `🧩` references**

Run: `grep -rn "🧩" packages/`
Expected: only the sidebar nav-item label in `packages/web/src/components/Sidebar.tsx` (out of scope — that emoji decorates the menu entry, not a phase). Leave it.

- [ ] **Step 4: Verify built-in phases still render their glyphs**

In the flow editor palette, confirm End (`■`), If/Else (`?`), XOR (`×`), AND (`+`), Loop (`↻`), Wait (`⏱`), Subflow (`⊞`), Human Task (`⏳`) still render correctly. These pass through `resolvePhaseIcon`'s plain-text fallback.

- [ ] **Step 5: Done**

No further commit unless something needed fixing in steps 1–4.

---

## Out of scope (do not implement in this plan)

- Raster icon upload (UI, server-side downscale, size-cap enforcement). The schema and `resolvePhaseIcon`'s `data:image/...` branch are already in place for a future plan.
- Per-node-instance icon override.
- Icon search/filter inside the picker.
