# Custom Steps Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom steps all-in-one modal with an agent-style full-page detail view: minimal create popup (name only) → left-sidebar section layout with per-section saves, enable/disable toggle, and flow-editor catalog visibility gating.

**Architecture:** Mirror `AgentDetail.tsx` exactly. Backend gains an `enabled` column on `jm_custom_ai_steps`, `enable`/`disable` endpoints, and a readiness check. Frontend gets a new `CustomStepDetail` page with 7 sidebar sections reusing the existing sub-editor components. The old `EditCustomStepModal` is deleted once the new page is wired in.

**Tech Stack:** TypeScript, React, Fastify, PostgreSQL (via `pg`), Vitest, React Router v6, Tailwind CSS.

---

## File Map

### Backend — new/modified

| File | Action |
|---|---|
| `packages/migrations/src/sql/061_custom_step_enabled.sql` | **Create** — adds `enabled` column |
| `packages/core/src/types/custom-steps.types.ts` | **Modify** — add `enabled: boolean` to `CustomAiStep` |
| `packages/custom-steps/src/readiness.ts` | **Create** — `checkCustomStepReadiness()` |
| `packages/custom-steps/src/readiness.test.ts` | **Create** — TDD for readiness |
| `packages/custom-steps/src/db.ts` | **Modify** — map `enabled` in `rowToStep`, add `enableCustomAiStep` / `disableCustomAiStep` |
| `packages/custom-steps/src/routes/workspace-custom-steps.ts` | **Modify** — enable/disable routes, PATCH guard, /visible filter |

### Frontend — new

| File | Action |
|---|---|
| `packages/web/src/api/customSteps.ts` | **Modify** — add `ReadinessError`, `enable`, `disable` |
| `packages/web/src/components/custom-steps/custom-step-form.ts` | **Create** — section helpers |
| `packages/web/src/components/custom-steps/CustomStepSectionNav.tsx` | **Create** — sidebar nav |
| `packages/web/src/components/custom-steps/sections/PromptSection.tsx` | **Create** |
| `packages/web/src/components/custom-steps/sections/DefinitionSection.tsx` | **Create** |
| `packages/web/src/components/custom-steps/sections/InputsSection.tsx` | **Create** |
| `packages/web/src/components/custom-steps/sections/OutputSection.tsx` | **Create** |
| `packages/web/src/components/custom-steps/sections/ToolsSection.tsx` | **Create** |
| `packages/web/src/components/custom-steps/sections/SecretsSection.tsx` | **Create** |
| `packages/web/src/components/custom-steps/sections/DeleteSection.tsx` | **Create** |
| `packages/web/src/components/custom-steps/CustomStepDetail.tsx` | **Create** — main detail page |
| `packages/web/src/routes/CustomStepDetailPage.tsx` | **Create** — route wrapper |

### Frontend — modified

| File | Action |
|---|---|
| `packages/web/src/App.tsx` | Add route `/workspaces/:wsId/custom-steps/:stepId` |
| `packages/web/src/components/custom-steps/CustomStepsList.tsx` | "+" → popup, Edit → navigate |

### Deleted

| File | When |
|---|---|
| `packages/web/src/components/custom-steps/EditCustomStepModal.tsx` | Task 12 (after new page is wired) |

### Test fixtures to update

| File | Change |
|---|---|
| `packages/custom-steps/src/export.test.ts` | Add `enabled: false` to both `CustomAiStep` literals |

---

## Task 1: DB migration

**Files:**
- Create: `packages/migrations/src/sql/061_custom_step_enabled.sql`

- [ ] **Step 1: Create the migration file**

```sql
ALTER TABLE jm_custom_ai_steps ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT false;
```

- [ ] **Step 2: Run the migration against the dev DB**

```bash
npm run migrate
```

Expected output: migration 061 applied, no errors.

---

## Task 2: Add `enabled` to the core type and fix test fixtures

**Files:**
- Modify: `packages/core/src/types/custom-steps.types.ts:34-62`
- Modify: `packages/custom-steps/src/export.test.ts:9-27` and `:66-67`

- [ ] **Step 1: Add `enabled` field to `CustomAiStep`**

In `packages/core/src/types/custom-steps.types.ts`, add `enabled: boolean;` after `icon`:

```typescript
export interface CustomAiStep {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  icon?: string | null;
  enabled: boolean;          // ← add this line
  inputFields: CustomStepInputField[];
  outputMode: CustomStepOutputMode;
  outputFields?: CustomStepOutputField[];
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

- [ ] **Step 2: Fix the test fixture in export.test.ts**

Add `enabled: false` to both `CustomAiStep` literals in `packages/custom-steps/src/export.test.ts`:

```typescript
const sampleStep: CustomAiStep = {
  id: "step-123",
  workspaceId: "ws-1",
  name: "Analyze Repo",
  description: "Look at the repo",
  icon: "lucide:Sparkles",
  enabled: false,            // ← add this
  inputFields: [{ name: "repoUrl", type: "string", required: true }],
  // ... rest unchanged
};
```

And the `minimal` object at line 66:

```typescript
const minimal: CustomAiStep = {
  ...sampleStep,
  enabled: false,            // already inherited via spread — no change needed
};
```

The spread already picks up `enabled` from `sampleStep`, so only `sampleStep` needs the explicit field.

- [ ] **Step 3: Run existing tests to confirm no breakage**

```bash
cd packages/custom-steps && npm test
```

Expected: all tests pass.

---

## Task 3: Update `db.ts` — map `enabled`, add enable/disable functions

**Files:**
- Modify: `packages/custom-steps/src/db.ts`

- [ ] **Step 1: Map `enabled` in `rowToStep`**

In `packages/custom-steps/src/db.ts`, inside `rowToStep`, add `enabled` after `icon`:

```typescript
function rowToStep(r: any): CustomAiStep {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    description: r.description ?? "",
    icon: r.icon ?? null,
    enabled: r.enabled ?? false,   // ← add this
    inputFields: r.input_fields ?? [],
    outputMode: r.output_mode,
    outputFields: Array.isArray(r.output_schema) ? r.output_schema : [],
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

- [ ] **Step 2: Add `enableCustomAiStep` and `disableCustomAiStep` at the end of `db.ts`**

```typescript
export async function enableCustomAiStep(pool: Pool, id: string): Promise<CustomAiStep | null> {
  const { rows } = await pool.query(
    `UPDATE jm_custom_ai_steps SET enabled = true, updated_at = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? rowToStep(rows[0]) : null;
}

export async function disableCustomAiStep(pool: Pool, id: string): Promise<CustomAiStep | null> {
  const { rows } = await pool.query(
    `UPDATE jm_custom_ai_steps SET enabled = false, updated_at = now() WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? rowToStep(rows[0]) : null;
}

export async function listEnabledCustomAiSteps(
  pool: Pool,
  workspaceId: string,
): Promise<CustomAiStep[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_custom_ai_steps WHERE workspace_id = $1 AND enabled = true ORDER BY name`,
    [workspaceId],
  );
  return rows.map(rowToStep);
}
```

---

## Task 4: Readiness check (TDD)

**Files:**
- Create: `packages/custom-steps/src/readiness.test.ts`
- Create: `packages/custom-steps/src/readiness.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/custom-steps/src/readiness.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { checkCustomStepReadiness } from "./readiness.ts";
import type { CustomAiStep } from "@journeyman/core";

const ok: CustomAiStep = {
  id: "s1",
  workspaceId: "ws1",
  name: "My Step",
  description: "",
  icon: null,
  enabled: false,
  inputFields: [],
  outputMode: "none",
  outputFields: [],
  promptTemplate: "Do the thing.",
  defaultTools: [],
  defaultMcpIds: [],
  defaultSkillIds: [],
  requiresSkills: false,
  requiresMcp: false,
  slots: [],
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("checkCustomStepReadiness", () => {
  it("passes a valid step", () => {
    expect(checkCustomStepReadiness(ok)).toEqual([]);
  });

  it("flags empty name", () => {
    const errs = checkCustomStepReadiness({ ...ok, name: "   " });
    expect(errs.some((e) => e.field === "name")).toBe(true);
  });

  it("flags empty promptTemplate", () => {
    const errs = checkCustomStepReadiness({ ...ok, promptTemplate: "" });
    expect(errs.some((e) => e.field === "promptTemplate")).toBe(true);
  });

  it("flags both when both are empty", () => {
    const errs = checkCustomStepReadiness({ ...ok, name: "", promptTemplate: "  " });
    expect(errs).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd packages/custom-steps && npm test -- --reporter=verbose readiness
```

Expected: FAIL with "Cannot find module './readiness.ts'"

- [ ] **Step 3: Implement `readiness.ts`**

Create `packages/custom-steps/src/readiness.ts`:

```typescript
import type { CustomAiStep } from "@journeyman/core";

export interface ReadinessError {
  field: string;
  message: string;
}

/** Returns [] when the step may be enabled; otherwise a list of blocking errors. */
export function checkCustomStepReadiness(step: CustomAiStep): ReadinessError[] {
  const errs: ReadinessError[] = [];
  if (!step.name.trim())
    errs.push({ field: "name", message: "Name is required" });
  if (!step.promptTemplate.trim())
    errs.push({ field: "promptTemplate", message: "Prompt template is required" });
  return errs;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd packages/custom-steps && npm test -- --reporter=verbose readiness
```

Expected: 4 tests pass.

---

## Task 5: API routes — enable/disable, PATCH guard, /visible filter

**Files:**
- Modify: `packages/custom-steps/src/routes/workspace-custom-steps.ts`

- [ ] **Step 1: Add the new DB imports to the route file**

At the top of `workspace-custom-steps.ts`, extend the DB import:

```typescript
import {
  DuplicateCustomStepError,
  deleteCustomAiStep,
  disableCustomAiStep,
  enableCustomAiStep,
  getCustomAiStep,
  insertCustomAiStep,
  listCustomAiSteps,
  listEnabledCustomAiSteps,
  updateCustomAiStep,
} from "../db.ts";
import { checkCustomStepReadiness } from "../readiness.ts";
```

- [ ] **Step 2: Guard the PATCH endpoint against editing an enabled step**

In the existing `PATCH /api/workspaces/:wsId/custom-steps/:id` handler, add the enabled guard after the 404 check:

```typescript
  app.patch("/api/workspaces/:wsId/custom-steps/:id", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const existing = await getCustomAiStep(pool, id);
    if (!existing || existing.workspaceId !== wsId) return reply.code(404).send({ error: "Not found" });
    // ↓ new guard
    if (existing.enabled) return reply.code(409).send({ error: "step_enabled_readonly" });
    // ... rest unchanged
```

- [ ] **Step 3: Update the /visible endpoint to filter by enabled=true**

Replace the `/visible` handler body:

```typescript
  // GET /api/workspaces/:wsId/custom-steps/visible (for flow-editor palette)
  app.get("/api/workspaces/:wsId/custom-steps/visible", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    return listEnabledCustomAiSteps(pool, wsId);
  });
```

- [ ] **Step 4: Add the enable and disable endpoints**

Add these two handlers after the existing `GET /:id/export` handler:

```typescript
  // POST /api/workspaces/:wsId/custom-steps/:id/enable
  app.post("/api/workspaces/:wsId/custom-steps/:id/enable", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const step = await getCustomAiStep(pool, id);
    if (!step || step.workspaceId !== wsId) return reply.code(404).send({ error: "not_found" });
    const errors = checkCustomStepReadiness(step);
    if (errors.length) {
      return reply.code(422).send({ error: "not_ready", errors });
    }
    const updated = await enableCustomAiStep(pool, id);
    return updated;
  });

  // POST /api/workspaces/:wsId/custom-steps/:id/disable
  app.post("/api/workspaces/:wsId/custom-steps/:id/disable", write, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const step = await getCustomAiStep(pool, id);
    if (!step || step.workspaceId !== wsId) return reply.code(404).send({ error: "not_found" });
    const updated = await disableCustomAiStep(pool, id);
    return updated;
  });
```

---

## Task 6: Frontend API client — add enable/disable

**Files:**
- Modify: `packages/web/src/api/customSteps.ts`

- [ ] **Step 1: Add `ReadinessError` type and `enable`/`disable` methods**

At the top of `packages/web/src/api/customSteps.ts`, add:

```typescript
export interface ReadinessError {
  field: string;
  message: string;
}
```

Then inside `customStepsApi`, add these two methods (after `remove`):

```typescript
  enable: async (wsId: string, id: string): Promise<CustomAiStep> => {
    const r = await fetch(`${wsBase(wsId)}/${id}/enable`, { method: "POST", credentials: "include" });
    if (r.ok) return r.json() as Promise<CustomAiStep>;
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (r.status === 422 && Array.isArray(body.errors)) {
      const err = new Error((body.error as string) ?? "not_ready");
      (err as any).readinessErrors = body.errors as ReadinessError[];
      throw err;
    }
    throw new Error((body.error as string) ?? `HTTP ${r.status}`);
  },

  disable: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/disable`, { method: "POST", credentials: "include" })
      .then(jsonOrThrow<CustomAiStep>),
```

---

## Task 7: custom-step-form.ts — section helpers

**Files:**
- Create: `packages/web/src/components/custom-steps/custom-step-form.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { CustomAiStep, CustomAiStepUpdateInput } from "@journeyman/core";
import type { SectionId } from "./CustomStepSectionNav.tsx";

/** Badge label shown in the header: "ENABLED" or "DRAFT". */
export function statusLabel(step: CustomAiStep): string {
  return step.enabled ? "ENABLED" : "DRAFT";
}

/** Which CustomAiStep fields each saveable section owns. */
const SECTION_FIELDS: Partial<Record<SectionId, readonly (keyof CustomAiStep)[]>> = {
  prompt:     ["promptTemplate"],
  definition: ["name", "description", "icon"],
  inputs:     ["inputFields"],
  output:     ["outputMode", "outputFields"],
  tools:      ["defaultTools", "defaultMcpIds", "defaultSkillIds", "requiresSkills", "requiresMcp"],
  secrets:    ["slots"],
};

/** Section IDs that have a Save button (delete has none). */
export const SAVEABLE_SECTION_IDS: readonly SectionId[] = [
  "prompt", "definition", "inputs", "output", "tools", "secrets",
];

/** True when any field the section owns has changed from original to current. */
export function isSectionDirty(
  original: CustomAiStep,
  current: CustomAiStep,
  section: SectionId,
): boolean {
  const fields = SECTION_FIELDS[section] ?? [];
  return fields.some((f) => JSON.stringify(original[f]) !== JSON.stringify(current[f]));
}

/** True when ANY saveable field has changed (used to guard enable). */
export function isStepDirty(original: CustomAiStep, current: CustomAiStep): boolean {
  return SAVEABLE_SECTION_IDS.some((id) => isSectionDirty(original, current, id));
}

/** Build a partial update payload containing only a section's owned fields. */
export function buildSectionUpdateInput(
  step: CustomAiStep,
  section: SectionId,
): CustomAiStepUpdateInput {
  const fields = SECTION_FIELDS[section] ?? [];
  return Object.fromEntries(fields.map((f) => [f, step[f]])) as CustomAiStepUpdateInput;
}
```

---

## Task 8: CustomStepSectionNav.tsx

**Files:**
- Create: `packages/web/src/components/custom-steps/CustomStepSectionNav.tsx`

- [ ] **Step 1: Create the file**

```typescript
export type SectionId =
  | "prompt" | "definition" | "inputs" | "output" | "tools" | "secrets" | "delete";

export const SECTIONS: Array<{ id: SectionId; label: string; icon: string; danger?: boolean }> = [
  { id: "prompt",     label: "Prompt",     icon: "✨" },
  { id: "definition", label: "Definition", icon: "📝" },
  { id: "inputs",     label: "Inputs",     icon: "↘️" },
  { id: "output",     label: "Output",     icon: "↗️" },
  { id: "tools",      label: "Tools",      icon: "🔧" },
  { id: "secrets",    label: "Secrets",    icon: "🔑" },
  { id: "delete",     label: "Delete step", icon: "🗑", danger: true },
];

export function CustomStepSectionNav({
  active,
  onSelect,
  dirtyIds = [],
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  dirtyIds?: SectionId[];
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {SECTIONS.map((s) => {
        const isActive = active === s.id;
        const separated = s.danger;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition",
              separated ? "mt-2 pt-3 border-t" : "",
              s.danger
                ? isActive
                  ? "bg-destructive/10 text-destructive font-medium"
                  : "text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                : isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="w-4 text-center opacity-80">{s.icon}</span>
            <span className="flex-1">{s.label}</span>
            {dirtyIds.includes(s.id) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
```

---

## Task 9: Section components

**Files:**
- Create: `packages/web/src/components/custom-steps/sections/PromptSection.tsx`
- Create: `packages/web/src/components/custom-steps/sections/DefinitionSection.tsx`
- Create: `packages/web/src/components/custom-steps/sections/InputsSection.tsx`
- Create: `packages/web/src/components/custom-steps/sections/OutputSection.tsx`
- Create: `packages/web/src/components/custom-steps/sections/ToolsSection.tsx`
- Create: `packages/web/src/components/custom-steps/sections/SecretsSection.tsx`
- Create: `packages/web/src/components/custom-steps/sections/DeleteSection.tsx`

- [ ] **Step 1: Create a shared SectionProps type in a new file**

Create `packages/web/src/components/custom-steps/sections/types.ts`:

```typescript
import type { CustomAiStep, CustomAiStepUpdateInput } from "@journeyman/core";

export interface SectionProps {
  step: CustomAiStep;
  patch: (p: CustomAiStepUpdateInput) => void;
  locked: boolean;
}
```

- [ ] **Step 2: Create PromptSection.tsx**

```typescript
import { SectionShell, FieldLabel } from "../../agents/sections/SectionShell.tsx";
import { inputCls } from "../../../routes/admin-styles.ts";
import type { SectionProps } from "./types.ts";

export function PromptSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Prompt"
      description="The instructions sent to the AI model on each run. Reference inputs with {{name}}."
    >
      <div>
        <FieldLabel>Prompt template</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[200px] font-mono text-xs`}
          disabled={locked}
          value={step.promptTemplate}
          onChange={(e) => patch({ promptTemplate: e.target.value })}
        />
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 3: Create DefinitionSection.tsx**

```typescript
import { SectionShell, FieldLabel } from "../../agents/sections/SectionShell.tsx";
import { inputCls } from "../../../routes/admin-styles.ts";
import { IconPicker } from "../IconPicker.tsx";
import type { SectionProps } from "./types.ts";

export function DefinitionSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Definition"
      description="How this step identifies itself in the workflow editor palette."
    >
      <div>
        <FieldLabel>Name</FieldLabel>
        <input
          className={inputCls}
          disabled={locked}
          value={step.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. Summarize PR"
        />
      </div>
      <div>
        <FieldLabel>Description</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[80px]`}
          disabled={locked}
          value={step.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="What this step does, and when a flow author would reach for it."
        />
      </div>
      <div>
        <FieldLabel>Icon</FieldLabel>
        {locked ? (
          <div className="text-sm text-muted-foreground">{step.icon ?? "Default"}</div>
        ) : (
          <IconPicker value={step.icon ?? null} onChange={(v) => patch({ icon: v })} />
        )}
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 4: Create InputsSection.tsx**

```typescript
import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { InputFieldsEditor } from "../InputFieldsEditor.tsx";
import type { SectionProps } from "./types.ts";

export function InputsSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Inputs"
      description="Declared inputs are wirable in the flow editor. Reference them in the prompt with {{name}}."
    >
      <InputFieldsEditor
        value={step.inputFields}
        onChange={(v) => patch({ inputFields: v })}
        disabled={locked}
      />
    </SectionShell>
  );
}
```

> **Note:** `InputFieldsEditor` may not accept a `disabled` prop. If it does not, wrap the editor in a `<fieldset disabled={locked}>` instead:
> ```typescript
> <fieldset disabled={locked} className="contents">
>   <InputFieldsEditor value={step.inputFields} onChange={(v) => patch({ inputFields: v })} />
> </fieldset>
> ```

- [ ] **Step 5: Create OutputSection.tsx**

```typescript
import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { OutputSchemaEditor } from "../OutputSchemaEditor.tsx";
import type { SectionProps } from "./types.ts";

export function OutputSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Output"
      description="Structured output is validated against your JSON schema by the model SDK."
    >
      <OutputSchemaEditor
        mode={step.outputMode}
        fields={step.outputFields ?? []}
        onModeChange={(v) => patch({ outputMode: v })}
        onFieldsChange={(v) => patch({ outputFields: v })}
        disabled={locked}
      />
    </SectionShell>
  );
}
```

> **Note:** If `OutputSchemaEditor` does not accept `disabled`, wrap in `<fieldset disabled={locked} className="contents">`.

- [ ] **Step 6: Create ToolsSection.tsx**

```typescript
import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { ToolsPicker } from "../ToolsPicker.tsx";
import type { SectionProps } from "./types.ts";

export function ToolsSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Tools"
      description="Canonical tools and integrations this step's prompt may use by default."
    >
      <fieldset disabled={locked} className="contents">
        <ToolsPicker
          value={step.defaultTools}
          onChange={(v) => patch({ defaultTools: v })}
        />
      </fieldset>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={step.requiresSkills}
            onChange={(e) => patch({ requiresSkills: e.target.checked })}
          />
          Skills required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={step.requiresMcp}
            onChange={(e) => patch({ requiresMcp: e.target.checked })}
          />
          MCP required
        </label>
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 7: Create SecretsSection.tsx**

```typescript
import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { SecretsEditor } from "../SecretsEditor.tsx";
import type { SectionProps } from "./types.ts";

export function SecretsSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Secrets"
      description="Credential slots this step needs at runtime. Flow authors bind each slot per node."
    >
      <fieldset disabled={locked} className="contents">
        <SecretsEditor
          value={step.slots}
          onChange={(v) => patch({ slots: v })}
          hasBashTool={step.defaultTools.includes("bash")}
        />
      </fieldset>
    </SectionShell>
  );
}
```

- [ ] **Step 8: Create DeleteSection.tsx**

```typescript
import { useState } from "react";
import type { CustomAiStep } from "@journeyman/core";
import { customStepsApi } from "../../../api/customSteps.ts";
import { inputCls, btnDanger } from "../../../routes/admin-styles.ts";
import { SectionShell } from "../../agents/sections/SectionShell.tsx";

export function DeleteSection({
  step,
  wsId,
  locked,
  onDeleted,
}: {
  step: CustomAiStep;
  wsId: string;
  locked: boolean;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmText.trim() === step.name;

  const del = async () => {
    if (!matches || locked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await customStepsApi.remove(wsId, step.id);
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="Delete step"
      description="Permanently delete this custom step. This cannot be undone."
    >
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
        {locked ? (
          <p className="text-sm text-muted-foreground">Disable the step before deleting it.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{step.name}</span> to confirm.
            </p>
            <input
              className={inputCls}
              placeholder={step.name}
              value={confirmText}
              disabled={busy}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {error && <div className="text-sm text-destructive">{error}</div>}
            <button className={btnDanger} disabled={!matches || busy} onClick={del}>
              {busy ? "Deleting…" : "Delete step"}
            </button>
          </>
        )}
      </div>
    </SectionShell>
  );
}
```

---

## Task 10: CustomStepDetail.tsx — main detail page

**Files:**
- Create: `packages/web/src/components/custom-steps/CustomStepDetail.tsx`

- [ ] **Step 1: Create the file**

```typescript
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { CustomAiStep, CustomAiStepUpdateInput } from "@journeyman/core";
import { customStepsApi, type ReadinessError } from "../../api/customSteps.ts";
import { Toggle } from "../Toggle.tsx";
import { btnPrimary, card } from "../../routes/admin-styles.ts";
import {
  isStepDirty,
  isSectionDirty,
  buildSectionUpdateInput,
  SAVEABLE_SECTION_IDS,
  statusLabel,
} from "./custom-step-form.ts";
import {
  CustomStepSectionNav,
  SECTIONS,
  type SectionId,
} from "./CustomStepSectionNav.tsx";
import { PromptSection }     from "./sections/PromptSection.tsx";
import { DefinitionSection } from "./sections/DefinitionSection.tsx";
import { InputsSection }     from "./sections/InputsSection.tsx";
import { OutputSection }     from "./sections/OutputSection.tsx";
import { ToolsSection }      from "./sections/ToolsSection.tsx";
import { SecretsSection }    from "./sections/SecretsSection.tsx";
import { DeleteSection }     from "./sections/DeleteSection.tsx";

const FIELD_TO_SECTION: Record<string, SectionId> = {
  name:           "definition",
  promptTemplate: "prompt",
};

const SECTION_SHORT_LABELS: Partial<Record<SectionId, string>> = {
  prompt:     "Prompt",
  definition: "Definition",
  inputs:     "Inputs",
  output:     "Output",
  tools:      "Tools",
  secrets:    "Secrets",
};

function SectionSaveBar({
  dirty,
  saving,
  locked,
  label,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  locked: boolean;
  label: string;
  onSave: () => void;
}) {
  if (!dirty) return null;
  return (
    <div className="shrink-0 border-t px-6 py-3 flex items-center justify-between bg-background">
      <span className="text-xs text-muted-foreground">● Unsaved changes</span>
      <button className={btnPrimary} disabled={locked || saving} onClick={onSave}>
        {saving ? "Saving…" : `Save ${label}`}
      </button>
    </div>
  );
}

export function CustomStepDetail({
  wsId,
  initial,
}: {
  wsId: string;
  initial: CustomAiStep;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawSection = params.get("section") ?? "prompt";
  const section = (SECTIONS.some((s) => s.id === rawSection) ? rawSection : "prompt") as SectionId;

  const [original, setOriginal] = useState<CustomAiStep>(initial);
  const [step, setStep] = useState<CustomAiStep>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readinessErrors, setReadinessErrors] = useState<ReadinessError[] | null>(null);

  const locked = step.enabled;
  const backTo = `/workspaces/${wsId}/custom-steps`;

  const sectionDirty = isSectionDirty(original, step, section);
  const dirtySections = SAVEABLE_SECTION_IDS.filter((id) => isSectionDirty(original, step, id));

  const patch = (p: CustomAiStepUpdateInput) => setStep((prev) => ({ ...prev, ...p }));
  const selectSection = (id: SectionId) => setParams({ section: id }, { replace: true });

  const guarded = (id: SectionId) => {
    if (sectionDirty && !confirm("You have unsaved changes in this section. Discard them?")) return;
    selectSection(id);
  };

  const mergeSection = (prev: CustomAiStep, updated: CustomAiStep, sectionId: SectionId): CustomAiStep => {
    const input = buildSectionUpdateInput(updated, sectionId);
    return { ...prev, ...(input as Partial<CustomAiStep>) };
  };

  const saveSection = async (sectionId: SectionId) => {
    setSaving(true);
    setError(null);
    try {
      const input = buildSectionUpdateInput(step, sectionId);
      const updated = await customStepsApi.update(wsId, step.id, input);
      setOriginal((prev) => mergeSection(prev, updated, sectionId));
      setStep((prev) => mergeSection(prev, updated, sectionId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnable = async () => {
    if (!step.enabled && isStepDirty(original, step)) {
      setError("Save your changes before enabling.");
      return;
    }
    setBusy(true);
    setError(null);
    setReadinessErrors(null);
    try {
      const updated = step.enabled
        ? await customStepsApi.disable(wsId, step.id)
        : await customStepsApi.enable(wsId, step.id);
      setOriginal(updated);
      setStep(updated);
    } catch (e: any) {
      if ((e as any).readinessErrors) {
        setReadinessErrors((e as any).readinessErrors as ReadinessError[]);
      } else {
        setError(e?.message ?? String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background px-6 pt-6 pb-4">
        <Link to={backTo} className="text-xs text-muted-foreground hover:text-foreground">
          ← Custom Steps
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{step.name}</h1>
              <span className="text-[11px] font-semibold tracking-wide rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                {statusLabel(step)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={step.enabled} disabled={busy} onChange={toggleEnable} label="Enabled" />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">
        {readinessErrors && readinessErrors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-semibold text-destructive mb-2">
              ⚠ Can't enable — fix these issues first:
            </p>
            <ul className="space-y-1">
              {readinessErrors.map((e) => {
                const targetSection = FIELD_TO_SECTION[e.field] as SectionId | undefined;
                const label = targetSection
                  ? SECTIONS.find((s) => s.id === targetSection)?.label ?? e.field
                  : e.field;
                return (
                  <li key={e.field} className="text-sm text-destructive">
                    {targetSection ? (
                      <button
                        className="font-medium underline hover:no-underline"
                        onClick={() => selectSection(targetSection)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="font-medium">{label}</span>
                    )}
                    {" — "}{e.message}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {locked && (
          <div className="rounded-md bg-muted text-muted-foreground text-sm px-4 py-2">
            🔒 Enabled — disable to edit.
          </div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className={`${card} overflow-hidden`}>
          <div className="flex min-h-[500px]">
            <aside className="w-56 shrink-0 border-r p-3">
              <CustomStepSectionNav
                active={section}
                onSelect={guarded}
                dirtyIds={dirtySections as SectionId[]}
              />
            </aside>
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-6">
                {section === "prompt"     && <PromptSection     step={step} patch={patch} locked={locked} />}
                {section === "definition" && <DefinitionSection step={step} patch={patch} locked={locked} />}
                {section === "inputs"     && <InputsSection     step={step} patch={patch} locked={locked} />}
                {section === "output"     && <OutputSection     step={step} patch={patch} locked={locked} />}
                {section === "tools"      && <ToolsSection      step={step} patch={patch} locked={locked} />}
                {section === "secrets"    && <SecretsSection    step={step} patch={patch} locked={locked} />}
                {section === "delete"     && (
                  <DeleteSection
                    step={step}
                    wsId={wsId}
                    locked={locked}
                    onDeleted={() => navigate(backTo)}
                  />
                )}
              </div>
              <SectionSaveBar
                dirty={sectionDirty}
                saving={saving}
                locked={locked}
                label={SECTION_SHORT_LABELS[section] ?? ""}
                onSave={() => saveSection(section)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 11: Route wrapper page

**Files:**
- Create: `packages/web/src/routes/CustomStepDetailPage.tsx`

- [ ] **Step 1: Create the page component**

```typescript
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { CustomAiStep } from "@journeyman/core";
import { customStepsApi } from "../api/customSteps.ts";
import { CustomStepDetail } from "../components/custom-steps/CustomStepDetail.tsx";

export function CustomStepDetailPage() {
  const { wsId = "", stepId = "" } = useParams<{ wsId: string; stepId: string }>();
  const [step, setStep] = useState<CustomAiStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wsId || !stepId) return;
    customStepsApi.get(wsId, stepId).then(setStep).catch((e) => setError(e?.message ?? String(e)));
  }, [wsId, stepId]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!step) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  return <CustomStepDetail wsId={wsId} initial={step} />;
}
```

---

## Task 12: Wire the new route and update the list

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/custom-steps/CustomStepsList.tsx`
- Delete: `packages/web/src/components/custom-steps/EditCustomStepModal.tsx`

- [ ] **Step 1: Register the new route in App.tsx**

In `packages/web/src/App.tsx`, add the import and route after the existing custom-steps route:

```typescript
// add import at top with other page imports:
import { CustomStepDetailPage } from "./routes/CustomStepDetailPage.tsx";

// add route after the existing custom-steps route:
<Route path="/workspaces/:wsId/custom-steps" element={<CustomStepsPage />} />
<Route path="/workspaces/:wsId/custom-steps/:stepId" element={<CustomStepDetailPage />} />  {/* ← new */}
```

- [ ] **Step 2: Update CustomStepsList.tsx**

Replace the file with a version that:
- Changes "+" button to open a **popup modal dialog** (overlay, not inline) asking for a name
- Changes Edit button to navigate to the detail page
- Removes the `EditCustomStepModal` import and usage

```typescript
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CustomAiStep } from "@journeyman/core";
import { customStepsApi } from "../../api/customSteps.ts";
import { btnDanger, btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";

function CreateStepModal({
  wsId,
  onCreated,
  onCancel,
}: {
  wsId: string;
  onCreated: (step: CustomAiStep) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await customStepsApi.create(wsId, { name: name.trim() });
      onCreated(created);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-base font-semibold">New custom step</h2>
        <p className="text-xs text-muted-foreground">You can configure everything else after creation.</p>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Step name</label>
          <input
            autoFocus
            className={inputCls}
            placeholder="e.g. Summarize PR"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
            disabled={busy}
          />
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} disabled={busy} onClick={onCancel}>Cancel</button>
          <button className={btnPrimary} disabled={!name.trim() || busy} onClick={submit}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomStepsList(props: { wsId: string }) {
  const { wsId } = props;
  const navigate = useNavigate();
  const [items, setItems] = useState<CustomAiStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setItems(await customStepsApi.list(wsId));
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wsId]);

  const handleDelete = async (p: CustomAiStep) => {
    if (!confirm(`Delete custom step "${p.name}"?`)) return;
    await customStepsApi.remove(wsId, p.id);
    await refresh();
  };

  const handleImport = async (parsed: unknown) => {
    try {
      await customStepsApi.importOne(wsId, parsed);
      await refresh();
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes("name_conflict")) {
        const renamed = window.prompt(
          "A custom step with this name already exists. Enter a new name to import as, or Cancel.",
        );
        if (!renamed) return;
        if (typeof parsed === "object" && parsed !== null && "step" in (parsed as any)) {
          (parsed as any).step.name = renamed;
          try {
            await customStepsApi.importOne(wsId, parsed);
            await refresh();
            return;
          } catch (retryErr: any) {
            setError(retryErr?.message ?? String(retryErr));
            return;
          }
        }
      }
      setError(msg);
    }
  };

  return (
    <>
      <section className={`${card} overflow-hidden`}>
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-base font-medium text-slate-100">
            Steps
            <span className="text-slate-500 font-normal ml-2">({items.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              ref={fileInputRef}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const text = await file.text();
                  let parsed: unknown;
                  try { parsed = JSON.parse(text); }
                  catch { throw new Error("File is not valid JSON"); }
                  await handleImport(parsed);
                } catch (err: any) {
                  setError(err?.message ?? String(err));
                }
              }}
            />
            <button className={btnGhost} onClick={() => fileInputRef.current?.click()}>
              Import
            </button>
            <button className={btnPrimary} onClick={() => setShowCreate(true)}>
              + New custom step
            </button>
          </div>
        </div>

        {error && (
          <div className="px-6 py-3 text-sm text-danger border-b border-danger/25 bg-danger/10">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No custom steps yet. Create one to make it available in the flow editor.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-subtle text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-6 py-3">Name</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-left font-medium px-6 py-3">Output</th>
                <th className="text-left font-medium px-6 py-3">Inputs</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 border-t border-slate-700">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-surface-hover">
                  <td className="px-6 py-3">
                    <div className="text-slate-100 font-medium">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{p.description}</div>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <span className={codePill}>{p.enabled ? "enabled" : "draft"}</span>
                  </td>
                  <td className="px-6 py-3 text-slate-300">
                    <span className={codePill}>{p.outputMode}</span>
                  </td>
                  <td className="px-6 py-3 text-slate-300">{p.inputFields.length}</td>
                  <td className="px-6 py-3 text-right whitespace-nowrap space-x-2">
                    <button
                      className={btnGhost}
                      onClick={async () => {
                        try {
                          await customStepsApi.exportOne(wsId, p.id);
                        } catch (err: any) {
                          setError(err?.message ?? String(err));
                        }
                      }}
                    >
                      Export
                    </button>
                    <button
                      className={btnGhost}
                      onClick={() => navigate(`/workspaces/${wsId}/custom-steps/${p.id}`)}
                    >
                      Edit
                    </button>
                    <button className={btnDanger} onClick={() => handleDelete(p)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showCreate && (
        <CreateStepModal
          wsId={wsId}
          onCreated={(created) => navigate(`/workspaces/${wsId}/custom-steps/${created.id}?section=prompt`)}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Delete EditCustomStepModal.tsx**

```bash
rm packages/web/src/components/custom-steps/EditCustomStepModal.tsx
```

---

## Task 13: Typecheck

- [ ] **Step 1: Run the full typecheck**

```bash
npm run typecheck
```

Expected: no TypeScript errors. Fix any type errors before declaring done.

- [ ] **Step 2: Run the boundary check**

```bash
npm run check:boundaries
```

Expected: no boundary violations.

- [ ] **Step 3: Run all custom-steps package tests**

```bash
cd packages/custom-steps && npm test
```

Expected: all tests pass including the new readiness tests.
