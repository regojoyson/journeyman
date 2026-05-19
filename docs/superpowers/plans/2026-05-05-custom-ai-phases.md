# Custom AI Phases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users define and run their own AI phases (typed inputs → optional structured output) per-user or per-org, dropped into flows like any built-in phase.

**Architecture:** New `@journeyman/custom-phases` package owns DB schema + routes + catalog merge. One generic orchestrator handler interprets any custom-phase definition at run time via a new `ICodingCLI.runCustomPrompt` method. Flow editor adds a "Custom" catalog category, a config drawer for `custom-ai` nodes, and live schema-break detection.

**Tech Stack:** TypeScript (npm workspaces), Postgres (jm_ tables), Fastify, React + Vite, `@anthropic-ai/claude-agent-sdk`.

**Constraints (per user):**
- **No commits** during implementation. Save and move on.
- **Typecheck only at the end.** No incremental verification.
- **No unit tests.** Implementation-only steps.

**Spec:** [docs/superpowers/specs/2026-05-05-custom-ai-phases-design.md](../specs/2026-05-05-custom-ai-phases-design.md)

---

## File Structure

### New files

```
packages/migrations/src/sql/012_custom_ai_phases.sql

packages/core/src/types/custom-phases.types.ts

packages/custom-phases/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── db.ts
    ├── prompt-renderer.ts
    ├── schema-diff.ts
    ├── catalog.ts
    └── routes/
        ├── index.ts
        ├── user-custom-phases.ts
        ├── org-custom-phases.ts
        └── visible.ts

packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts

packages/web/src/api/customPhases.ts
packages/web/src/routes/MyCustomPhasesPage.tsx
packages/web/src/routes/AdminCustomPhasesPage.tsx
packages/web/src/components/custom-phases/CustomPhasesList.tsx
packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx
packages/web/src/components/custom-phases/InputFieldsEditor.tsx
packages/web/src/components/custom-phases/OutputSchemaEditor.tsx
```

### Modified files

```
packages/core/src/types/coding.types.ts          (+ RunCustomPromptOptions/Result)
packages/core/src/interfaces/coding-cli.interface.ts  (+ runCustomPrompt)
packages/core/src/index.ts                       (re-export new types)

packages/coding-cli/src/providers/claude/index.ts     (+ runCustomPrompt)
packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts  (NEW)
packages/coding-cli/src/providers/gemini/index.ts     (+ runCustomPrompt stub)
packages/coding-cli/src/providers/codex/index.ts      (+ runCustomPrompt stub)

packages/orchestrator/src/cli-worker.ts          (register CustomAiPhaseHandler)

packages/api-server/src/server.ts                (registerCustomPhaseRoutes)

packages/phases/src/catalog.ts                   (export buildPhaseCatalog merger)
packages/phases/src/index.ts                     (re-export buildPhaseCatalog)
packages/phases/src/registry.ts                  (export buildPhasesRegistry merger)

packages/flow-editor/src/catalogs/                (Custom category support)
packages/flow-editor/src/properties-panel/        (custom-ai node drawer)
packages/flow-editor/src/state/                   (schema-break diff hooks)

packages/web/src/App.tsx                          (+ routes)
packages/web/src/components/sidebar/              (+ nav links)

package.json                                      (add custom-phases workspace)
```

---

## Task 1: DB migration

**Files:**
- Create: `packages/migrations/src/sql/012_custom_ai_phases.sql`

- [ ] **Step 1: Write migration**

```sql
-- 012_custom_ai_phases.sql — user/org-scope custom AI phase definitions.

CREATE TABLE IF NOT EXISTS jm_custom_ai_phases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope            TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  user_id          UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  input_fields     JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_mode      TEXT NOT NULL DEFAULT 'none'
                     CHECK (output_mode IN ('none', 'text', 'structured')),
  output_schema    JSONB,
  prompt_template  TEXT NOT NULL DEFAULT '',
  needs_workspace  BOOLEAN NOT NULL DEFAULT false,
  default_provider TEXT,
  default_mcp_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by       UUID NOT NULL REFERENCES jm_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_custom_ai_phases_scope_name_unique
    UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_custom_ai_phases_org_user
  ON jm_custom_ai_phases (org_id, user_id);
```

---

## Task 2: Core types

**Files:**
- Create: `packages/core/src/types/custom-phases.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Define shared types**

`packages/core/src/types/custom-phases.types.ts`:

```ts
export type CustomPhaseScope = "user" | "org";
export type CustomPhaseOutputMode = "none" | "text" | "structured";

export type CustomPhaseInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "workspaceId" | "repoRef" | "issueRef";

export interface CustomPhaseInputField {
  name: string;
  type: CustomPhaseInputType;
  required: boolean;
  description?: string;
  default?: unknown;
}

// JSON Schema subset stored in output_schema (full JSON Schema is allowed;
// we only constrain what the editor produces).
export type CustomPhaseJsonSchema = Record<string, unknown>;

export interface CustomAiPhase {
  id: string;
  scope: CustomPhaseScope;
  userId?: string;
  orgId: string;
  name: string;
  description: string;
  inputFields: CustomPhaseInputField[];
  outputMode: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate: string;
  needsWorkspace: boolean;
  defaultProvider?: string;
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomAiPhaseCreateInput {
  scope: CustomPhaseScope;
  name: string;
  description?: string;
  inputFields?: CustomPhaseInputField[];
  outputMode?: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate?: string;
  needsWorkspace?: boolean;
  defaultProvider?: string;
  defaultMcpIds?: string[];
  defaultSkillIds?: string[];
}

export type CustomAiPhaseUpdateInput = Partial<Omit<CustomAiPhaseCreateInput, "scope">>;
```

- [ ] **Step 2: Re-export from core index**

Add to `packages/core/src/index.ts` (alongside other type re-exports):

```ts
export type {
  CustomPhaseScope,
  CustomPhaseOutputMode,
  CustomPhaseInputType,
  CustomPhaseInputField,
  CustomPhaseJsonSchema,
  CustomAiPhase,
  CustomAiPhaseCreateInput,
  CustomAiPhaseUpdateInput,
} from "./types/custom-phases.types.ts";
```

---

## Task 3: Extend ICodingCLI with `runCustomPrompt`

**Files:**
- Modify: `packages/core/src/types/coding.types.ts`
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts`

- [ ] **Step 1: Add option/result types**

Append to `packages/core/src/types/coding.types.ts`:

```ts
import type { ResolvedMcpInstance } from "./mcp.types.ts";
import type { ResolvedSkillPackage } from "./skill.types.ts";

export interface RunCustomPromptOptions {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: Record<string, unknown>;
  cwd?: string;
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkillPackage[];
  allowedTools?: string[];
  sessionId?: string;
  signal?: AbortSignal;
}

export interface RunCustomPromptResult {
  result?: string;
  structured?: unknown;
  error?: string;
}
```

(If existing imports already cover `ResolvedMcpInstance` / `ResolvedSkillPackage` in this file, do not duplicate the imports.)

- [ ] **Step 2: Add method to interface**

In `packages/core/src/interfaces/coding-cli.interface.ts`, extend the imports and interface:

```ts
import type {
  AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  RunCustomPromptOptions, RunCustomPromptResult,
} from "../types/coding.types.ts";

export interface ICodingCLI {
  // ...existing methods...
  runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult>;
}
```

- [ ] **Step 3: Re-export new types**

In `packages/core/src/index.ts`, add to the coding-types re-export block:

```ts
export type {
  RunCustomPromptOptions,
  RunCustomPromptResult,
} from "./types/coding.types.ts";
```

---

## Task 4: ClaudeProvider implementation of `runCustomPrompt`

**Files:**
- Create: `packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts`
- Modify: `packages/coding-cli/src/providers/claude/index.ts`

- [ ] **Step 1: Create operation**

`packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts`:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  RunCustomPromptOptions,
  RunCustomPromptResult,
} from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";

export async function runCustomPrompt(
  opts: RunCustomPromptOptions,
  apiKey: string | undefined,
): Promise<RunCustomPromptResult> {
  const useTools = Boolean(opts.cwd);
  const tools = useTools ? (opts.allowedTools ?? ["Bash"]) : [];

  const queryOptions: Record<string, unknown> = {
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    tools,
    allowedTools: tools,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.mcps && opts.mcps.length > 0 ? { mcpServers: mcpsToConfig(opts.mcps) } : {}),
    ...(opts.skills && opts.skills.length > 0 ? { skills: skillsToConfig(opts.skills) } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  if (opts.outputMode === "structured") {
    if (!opts.outputSchema) {
      return { error: "outputMode='structured' requires outputSchema" };
    }
    (queryOptions as any).outputFormat = {
      type: "json_schema",
      schema: opts.outputSchema,
    };
  }

  const response = query({ prompt: opts.prompt, options: queryOptions });

  for await (const msg of response) {
    logSdkMessage(msg);
    if ((msg as any).type === "result") {
      const m = msg as any;
      if (m.subtype !== "success") {
        return { error: m.errors?.[0] ?? m.subtype ?? "unknown failure" };
      }
      if (opts.outputMode === "none") return {};
      if (opts.outputMode === "text") {
        const text = typeof m.result === "string" ? m.result : (m.text ?? "");
        return { result: text };
      }
      return { structured: m.structured_output };
    }
  }
  return { error: "no result message returned from SDK" };
}

function mcpsToConfig(mcps: NonNullable<RunCustomPromptOptions["mcps"]>) {
  // Reuse the existing converter pattern from analyze/plan/implement.
  // If the codebase exposes `toMcpServerConfigs` from "@journeyman/mcp/sdk-adapter",
  // import and call it. Otherwise pass through the resolved instances directly,
  // matching whatever shape the existing AI ops use.
  // Lookup target: check how analyze.ts builds this; mirror exactly.
  return Object.fromEntries(mcps.map((m: any) => [m.name ?? m.id, m.config ?? m]));
}

function skillsToConfig(skills: NonNullable<RunCustomPromptOptions["skills"]>) {
  // Mirror the existing analyze/plan/implement skills wiring.
  return skills.map((s: any) => s.localPath ?? s.name ?? s.id);
}
```

> **Note:** the `mcpsToConfig` / `skillsToConfig` helpers exist in some form in the existing `analyze.ts` / `plan.ts` / `implement.ts` operations. **Open `packages/coding-cli/src/providers/claude/operations/analyze.ts` and copy the exact mapping logic** into this new operation rather than the placeholder above. The placeholder is correct for typecheck purposes but should be replaced with the proven shape.

- [ ] **Step 2: Wire to ClaudeProvider**

In `packages/coding-cli/src/providers/claude/index.ts`, add:

```ts
import { runCustomPrompt } from "./operations/run-custom-prompt.ts";
import type { RunCustomPromptOptions, RunCustomPromptResult } from "@journeyman/core";

// inside the class:
async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
  return runCustomPrompt(opts, this.apiKey);
}
```

(Use whatever field name the class uses for the API key, e.g. `this.opts.apiKey`.)

---

## Task 5: Stub `runCustomPrompt` on Gemini and Codex

**Files:**
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`
- Modify: `packages/coding-cli/src/providers/codex/index.ts`

- [ ] **Step 1: Gemini stub**

In `packages/coding-cli/src/providers/gemini/index.ts`, add:

```ts
async runCustomPrompt(): Promise<never> {
  throw new Error("GeminiProvider.runCustomPrompt not implemented");
}
```

- [ ] **Step 2: Codex stub**

In `packages/coding-cli/src/providers/codex/index.ts`, add:

```ts
async runCustomPrompt(): Promise<never> {
  throw new Error("CodexProvider.runCustomPrompt not implemented");
}
```

---

## Task 6: Bootstrap `@journeyman/custom-phases` package

**Files:**
- Create: `packages/custom-phases/package.json`
- Create: `packages/custom-phases/tsconfig.json`
- Create: `packages/custom-phases/src/index.ts`
- Modify: root `package.json` (workspaces array already includes `packages/*`; nothing needed if it does)

- [ ] **Step 1: package.json**

`packages/custom-phases/package.json`:

```json
{
  "name": "@journeyman/custom-phases",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./catalog": "./src/catalog.ts"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "fastify": "*",
    "pg": "*"
  },
  "devDependencies": {
    "typescript": "*"
  }
}
```

- [ ] **Step 2: tsconfig.json**

`packages/custom-phases/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

(If no `tsconfig.base.json` exists at the root, copy the shape from `packages/skills/tsconfig.json`.)

- [ ] **Step 3: index.ts placeholder**

`packages/custom-phases/src/index.ts`:

```ts
export { registerCustomPhaseRoutes } from "./routes/index.ts";
export {
  insertCustomAiPhase,
  getCustomAiPhase,
  listCustomAiPhases,
  listVisibleCustomAiPhases,
  updateCustomAiPhase,
  deleteCustomAiPhase,
  DuplicateCustomPhaseError,
} from "./db.ts";
export { renderPrompt } from "./prompt-renderer.ts";
export { diffCustomPhase } from "./schema-diff.ts";
export type { CustomPhaseDiff } from "./schema-diff.ts";
export { buildCustomPhaseCatalog } from "./catalog.ts";
```

---

## Task 7: DB layer for custom phases

**Files:**
- Create: `packages/custom-phases/src/db.ts`

- [ ] **Step 1: Write CRUD**

`packages/custom-phases/src/db.ts`:

```ts
import type { Pool } from "pg";
import type {
  CustomAiPhase,
  CustomAiPhaseCreateInput,
  CustomAiPhaseUpdateInput,
} from "@journeyman/core";

export class DuplicateCustomPhaseError extends Error {
  constructor(name: string) {
    super(`Custom phase name already in use: ${name}`);
    this.name = "DuplicateCustomPhaseError";
  }
}

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
    needsWorkspace: r.needs_workspace,
    defaultProvider: r.default_provider ?? undefined,
    defaultMcpIds: r.default_mcp_ids ?? [],
    defaultSkillIds: r.default_skill_ids ?? [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function insertCustomAiPhase(
  pool: Pool,
  input: CustomAiPhaseCreateInput & { orgId: string; userId: string | null; createdBy: string },
): Promise<CustomAiPhase> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_custom_ai_phases
         (scope, user_id, org_id, name, description,
          input_fields, output_mode, output_schema,
          prompt_template, needs_workspace,
          default_provider, default_mcp_ids, default_skill_ids,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
        input.needsWorkspace ?? false,
        input.defaultProvider ?? null,
        JSON.stringify(input.defaultMcpIds ?? []),
        JSON.stringify(input.defaultSkillIds ?? []),
        input.createdBy,
      ],
    );
    return rowToPhase(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateCustomPhaseError(input.name);
    throw err;
  }
}

export async function getCustomAiPhase(
  pool: Pool,
  id: string,
): Promise<CustomAiPhase | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_custom_ai_phases WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToPhase(rows[0]) : null;
}

export async function listCustomAiPhases(
  pool: Pool,
  orgId: string,
  userId: string | null,
): Promise<CustomAiPhase[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_custom_ai_phases
     WHERE org_id = $1
       AND COALESCE(user_id::text, '') = COALESCE($2::text, '')
     ORDER BY name ASC`,
    [orgId, userId],
  );
  return rows.map(rowToPhase);
}

export async function listVisibleCustomAiPhases(
  pool: Pool,
  orgId: string,
  userId: string,
): Promise<CustomAiPhase[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_custom_ai_phases
     WHERE org_id = $1
       AND (user_id IS NULL OR user_id = $2)
     ORDER BY name ASC`,
    [orgId, userId],
  );
  return rows.map(rowToPhase);
}

export async function updateCustomAiPhase(
  pool: Pool,
  id: string,
  patch: CustomAiPhaseUpdateInput,
): Promise<CustomAiPhase | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.name !== undefined)            push("name", patch.name);
  if (patch.description !== undefined)     push("description", patch.description);
  if (patch.inputFields !== undefined)     push("input_fields", JSON.stringify(patch.inputFields));
  if (patch.outputMode !== undefined)      push("output_mode", patch.outputMode);
  if (patch.outputSchema !== undefined)    push("output_schema", patch.outputSchema ? JSON.stringify(patch.outputSchema) : null);
  if (patch.promptTemplate !== undefined)  push("prompt_template", patch.promptTemplate);
  if (patch.needsWorkspace !== undefined)  push("needs_workspace", patch.needsWorkspace);
  if (patch.defaultProvider !== undefined) push("default_provider", patch.defaultProvider ?? null);
  if (patch.defaultMcpIds !== undefined)   push("default_mcp_ids", JSON.stringify(patch.defaultMcpIds));
  if (patch.defaultSkillIds !== undefined) push("default_skill_ids", JSON.stringify(patch.defaultSkillIds));
  if (sets.length === 0) return getCustomAiPhase(pool, id);
  sets.push(`updated_at = now()`);
  vals.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE jm_custom_ai_phases SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    return rows[0] ? rowToPhase(rows[0]) : null;
  } catch (err: any) {
    if (err.code === "23505" && patch.name) throw new DuplicateCustomPhaseError(patch.name);
    throw err;
  }
}

export async function deleteCustomAiPhase(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM jm_custom_ai_phases WHERE id = $1`, [id],
  );
  return (rowCount ?? 0) > 0;
}
```

---

## Task 8: Prompt renderer

**Files:**
- Create: `packages/custom-phases/src/prompt-renderer.ts`

- [ ] **Step 1: Implement substitution**

```ts
import type { CustomAiPhase } from "@journeyman/core";

export class MissingRequiredInputError extends Error {
  constructor(name: string) {
    super(`Missing required input: ${name}`);
    this.name = "MissingRequiredInputError";
  }
}

export function renderPrompt(
  phase: CustomAiPhase,
  values: Record<string, unknown>,
): string {
  for (const field of phase.inputFields) {
    if (field.required && (values[field.name] === undefined || values[field.name] === null)) {
      if (field.default === undefined) {
        throw new MissingRequiredInputError(field.name);
      }
    }
  }
  return phase.promptTemplate.replace(/\{\{\s*([a-zA-Z_$][\w$]*)\s*\}\}/g, (match, name) => {
    const v = values[name] ?? phase.inputFields.find((f) => f.name === name)?.default;
    if (v === undefined || v === null) return match;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v, null, 2);
  });
}
```

---

## Task 9: Schema-diff for the flow editor

**Files:**
- Create: `packages/custom-phases/src/schema-diff.ts`

- [ ] **Step 1: Implement diff**

```ts
import type { CustomAiPhase, CustomPhaseInputField } from "@journeyman/core";

export interface CustomPhaseDiff {
  inputErrors:   { fieldName: string; reason: "removed" | "type-changed" | "now-required" }[];
  inputWarnings: { fieldName: string; reason: "added-optional" }[];
  outputErrors:   { path: string; reason: "removed" }[];
  outputWarnings: { path: string; reason: "type-changed" }[];
}

export function diffCustomPhase(
  prev: CustomAiPhase,
  next: CustomAiPhase,
  wired: { wiredInputs: string[]; wiredOutputPaths: string[] },
): CustomPhaseDiff {
  const out: CustomPhaseDiff = {
    inputErrors: [], inputWarnings: [], outputErrors: [], outputWarnings: [],
  };

  const prevByName = new Map(prev.inputFields.map((f) => [f.name, f]));
  const nextByName = new Map(next.inputFields.map((f) => [f.name, f]));

  for (const name of wired.wiredInputs) {
    const p = prevByName.get(name);
    const n = nextByName.get(name);
    if (p && !n) out.inputErrors.push({ fieldName: name, reason: "removed" });
    else if (p && n && !typesCompatible(p, n)) out.inputErrors.push({ fieldName: name, reason: "type-changed" });
  }
  for (const [name, n] of nextByName) {
    if (!prevByName.has(name) && n.required) {
      out.inputErrors.push({ fieldName: name, reason: "now-required" });
    }
    if (!prevByName.has(name) && !n.required) {
      out.inputWarnings.push({ fieldName: name, reason: "added-optional" });
    }
  }

  if (prev.outputMode === "structured" && next.outputMode === "structured") {
    const prevPaths = collectPaths(prev.outputSchema);
    const nextPaths = collectPaths(next.outputSchema);
    for (const path of wired.wiredOutputPaths) {
      const pType = prevPaths.get(path);
      const nType = nextPaths.get(path);
      if (pType && !nType) out.outputErrors.push({ path, reason: "removed" });
      else if (pType && nType && pType !== nType) {
        out.outputWarnings.push({ path, reason: "type-changed" });
      }
    }
  } else if (prev.outputMode !== next.outputMode) {
    for (const path of wired.wiredOutputPaths) {
      out.outputErrors.push({ path, reason: "removed" });
    }
  }
  return out;
}

function typesCompatible(a: CustomPhaseInputField, b: CustomPhaseInputField): boolean {
  return a.type === b.type;
}

function collectPaths(schema: unknown, base = ""): Map<string, string> {
  const m = new Map<string, string>();
  if (!schema || typeof schema !== "object") return m;
  const props = (schema as any).properties;
  if (!props || typeof props !== "object") return m;
  for (const [key, val] of Object.entries(props)) {
    const path = base ? `${base}.${key}` : key;
    const t = (val as any)?.type ?? "unknown";
    m.set(path, typeof t === "string" ? t : "unknown");
    if (t === "object") {
      for (const [k, v] of collectPaths(val, path)) m.set(k, v);
    }
  }
  return m;
}
```

---

## Task 10: Catalog merger

**Files:**
- Create: `packages/custom-phases/src/catalog.ts`

- [ ] **Step 1: Build catalog entries**

```ts
import type { Pool } from "pg";
import type { CustomAiPhase } from "@journeyman/core";
import { listVisibleCustomAiPhases } from "./db.ts";

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
  needsWorkspace: boolean;
  defaultProvider?: string;
  defaultMcpIds: string[];
  defaultSkillIds: string[];
}

export async function buildCustomPhaseCatalog(
  pool: Pool,
  ctx: { orgId: string; userId: string },
): Promise<CustomPhaseCatalogEntry[]> {
  const phases = await listVisibleCustomAiPhases(pool, ctx.orgId, ctx.userId);
  return phases.map((p) => ({
    phaseType: "custom-ai",
    customPhaseId: p.id,
    scopeBadge: p.scope,
    category: "Custom",
    label: p.name,
    description: p.description,
    inputFields: p.inputFields,
    outputMode: p.outputMode,
    outputSchema: p.outputSchema,
    needsWorkspace: p.needsWorkspace,
    defaultProvider: p.defaultProvider,
    defaultMcpIds: p.defaultMcpIds,
    defaultSkillIds: p.defaultSkillIds,
  }));
}
```

---

## Task 11: REST routes — user-scoped

**Files:**
- Create: `packages/custom-phases/src/routes/user-custom-phases.ts`

- [ ] **Step 1: Write routes**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateCustomPhaseError,
  deleteCustomAiPhase,
  getCustomAiPhase,
  insertCustomAiPhase,
  listCustomAiPhases,
  updateCustomAiPhase,
} from "../db.ts";

export async function registerUserCustomPhaseRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/users/me/custom-phases",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listCustomAiPhases(pool, orgId, ctx.user.id);
    },
  );

  app.post(
    "/api/orgs/:orgId/users/me/custom-phases",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const rec = await insertCustomAiPhase(pool, {
          orgId,
          userId: ctx.user.id,
          createdBy: ctx.user.id,
          scope: "user",
          name: body.name,
          description: body.description,
          inputFields: body.inputFields,
          outputMode: body.outputMode,
          outputSchema: body.outputSchema,
          promptTemplate: body.promptTemplate,
          needsWorkspace: body.needsWorkspace,
          defaultProvider: body.defaultProvider,
          defaultMcpIds: body.defaultMcpIds,
          defaultSkillIds: body.defaultSkillIds,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.get(
    "/api/orgs/:orgId/users/me/custom-phases/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const rec = await getCustomAiPhase(pool, id);
      if (!rec || rec.orgId !== orgId || rec.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      return rec;
    },
  );

  app.patch(
    "/api/orgs/:orgId/users/me/custom-phases/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        return await updateCustomAiPhase(pool, id, req.body as any);
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.delete(
    "/api/orgs/:orgId/users/me/custom-phases/:id",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "Not found" });
      }
      await deleteCustomAiPhase(pool, id);
      reply.code(204);
      return null;
    },
  );
}
```

---

## Task 12: REST routes — org-scoped

**Files:**
- Create: `packages/custom-phases/src/routes/org-custom-phases.ts`

- [ ] **Step 1: Write routes**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import {
  DuplicateCustomPhaseError,
  deleteCustomAiPhase,
  getCustomAiPhase,
  insertCustomAiPhase,
  listCustomAiPhases,
  updateCustomAiPhase,
} from "../db.ts";

export async function registerOrgCustomPhaseRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/custom-phases",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listCustomAiPhases(pool, orgId, null);
    },
  );

  app.post(
    "/api/orgs/:orgId/custom-phases",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const body = req.body as any;
      try {
        const rec = await insertCustomAiPhase(pool, {
          orgId,
          userId: null,
          createdBy: ctx.user.id,
          scope: "org",
          name: body.name,
          description: body.description,
          inputFields: body.inputFields,
          outputMode: body.outputMode,
          outputSchema: body.outputSchema,
          promptTemplate: body.promptTemplate,
          needsWorkspace: body.needsWorkspace,
          defaultProvider: body.defaultProvider,
          defaultMcpIds: body.defaultMcpIds,
          defaultSkillIds: body.defaultSkillIds,
        });
        reply.code(201);
        return rec;
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.patch(
    "/api/orgs/:orgId/custom-phases/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.scope !== "org") {
        return reply.code(404).send({ error: "Not found" });
      }
      try {
        return await updateCustomAiPhase(pool, id, req.body as any);
      } catch (err) {
        if (err instanceof DuplicateCustomPhaseError) return reply.code(409).send({ error: err.message });
        throw err;
      }
    },
  );

  app.delete(
    "/api/orgs/:orgId/custom-phases/:id",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      const existing = await getCustomAiPhase(pool, id);
      if (!existing || existing.orgId !== orgId || existing.scope !== "org") {
        return reply.code(404).send({ error: "Not found" });
      }
      await deleteCustomAiPhase(pool, id);
      reply.code(204);
      return null;
    },
  );
}
```

---

## Task 13: REST routes — visible (combined)

**Files:**
- Create: `packages/custom-phases/src/routes/visible.ts`

- [ ] **Step 1: Write route**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listVisibleCustomAiPhases } from "../db.ts";

export async function registerVisibleCustomPhaseRoutes(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.get(
    "/api/orgs/:orgId/custom-phases/visible",
    { preHandler: requireAuth() },
    async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
      return listVisibleCustomAiPhases(pool, orgId, ctx.user.id);
    },
  );
}
```

---

## Task 14: Routes barrel + registration helper

**Files:**
- Create: `packages/custom-phases/src/routes/index.ts`

- [ ] **Step 1: Aggregate**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { registerUserCustomPhaseRoutes } from "./user-custom-phases.ts";
import { registerOrgCustomPhaseRoutes } from "./org-custom-phases.ts";
import { registerVisibleCustomPhaseRoutes } from "./visible.ts";

export async function registerCustomPhaseRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgCustomPhaseRoutes(app, pool);
  await registerUserCustomPhaseRoutes(app, pool);
  await registerVisibleCustomPhaseRoutes(app, pool);
}
```

---

## Task 15: Wire routes into api-server

**Files:**
- Modify: `packages/api-server/src/server.ts`
- Modify: `packages/api-server/package.json` (add dep)

- [ ] **Step 1: Add dependency**

Add to `packages/api-server/package.json` `dependencies`:

```json
"@journeyman/custom-phases": "*"
```

- [ ] **Step 2: Register routes**

In `packages/api-server/src/server.ts`, alongside existing imports/registrations:

```ts
import { registerCustomPhaseRoutes } from "@journeyman/custom-phases";

// inside the bootstrapping function, after registerSkillRoutes:
await registerCustomPhaseRoutes(app, c.pool);
```

---

## Task 16: Orchestrator handler — `custom-ai-phase-handler.ts`

**Files:**
- Create: `packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts`
- Modify: `packages/orchestrator/package.json` (add dep on `@journeyman/custom-phases` and `pg`)

- [ ] **Step 1: Add dependencies**

In `packages/orchestrator/package.json`:

```json
"@journeyman/custom-phases": "*",
"pg": "*"
```

- [ ] **Step 2: Implement handler**

```ts
import type { Pool } from "pg";
import {
  createLogger,
  type ICodingCLI,
  type IPhaseHandler,
  type PhaseContext,
  type PhaseInput,
  type PhaseRunResult,
  type ProviderFactory,
  type ResolvedMcpInstance,
  type ResolvedSkillPackage,
} from "@journeyman/core";
import { getCustomAiPhase, renderPrompt } from "@journeyman/custom-phases";

const log = createLogger("worker:custom-ai");

export class CustomAiPhaseHandler implements IPhaseHandler {
  readonly phaseType = "custom-ai";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI>; pool: Pool }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const customPhaseId = typeof input.customPhaseId === "string" ? input.customPhaseId : undefined;
    if (!customPhaseId) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "custom-ai phase requires customPhaseId in node config", retryable: false } };
    }
    const phase = await getCustomAiPhase(this.deps.pool, customPhaseId);
    if (!phase) {
      return { kind: "failure", failure: { errorClass: "CustomPhaseNotFound", message: `custom phase ${customPhaseId} not found`, retryable: false } };
    }

    const fieldValues: Record<string, unknown> = {};
    for (const f of phase.inputFields) fieldValues[f.name] = input[f.name];

    let prompt: string;
    try {
      prompt = renderPrompt(phase, fieldValues);
    } catch (err: any) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: err.message ?? String(err), retryable: false } };
    }

    const cwd = phase.needsWorkspace
      ? (typeof input.workspaceId === "string" ? input.workspaceId : undefined)
      : undefined;
    if (phase.needsWorkspace && !cwd) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "needs_workspace=true but no workspaceId input was wired", retryable: false } };
    }

    const provider = typeof input.provider === "string" ? input.provider : phase.defaultProvider;
    const coding = this.deps.coding(provider, ctx.env);

    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    const skills = Array.isArray(input.skills) ? (input.skills as ResolvedSkillPackage[]) : undefined;

    ctx.log(`Running custom phase "${phase.name}" (${phase.outputMode})`);

    const result = await coding.runCustomPrompt({
      prompt,
      outputMode: phase.outputMode,
      outputSchema: phase.outputSchema,
      cwd,
      mcps,
      skills,
      sessionId: ctx.runId,
      signal: ctx.signal,
    });

    if (result.error) {
      log.error({ phaseId: phase.id, err: result.error }, "custom-ai run failed");
      return { kind: "failure", failure: { errorClass: "CustomPhaseFailed", message: result.error, retryable: true } };
    }

    if (phase.outputMode === "none") return { kind: "success", output: {} };
    if (phase.outputMode === "text") return { kind: "success", output: { result: result.result ?? "" } };
    return { kind: "success", output: (result.structured as Record<string, unknown>) ?? {} };
  }
}
```

---

## Task 17: Register handler in cli-worker

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Wire up**

Add the import alongside other handler imports:

```ts
import { CustomAiPhaseHandler } from "./workers/phases/custom-ai-phase-handler.ts";
```

After the other `registry.register(...)` calls (a Pool is already constructed for skills/MCP resolution — find the existing pool variable; if not present, add a `new Pool()` import from `pg` and reuse the same connection string used by the rest of the orchestrator):

```ts
registry.register(new CustomAiPhaseHandler({ coding, pool }));
```

> **Lookup target:** the existing `cli-worker.ts` already constructs a `pg` Pool for the resolver/skills installation. Reuse that same `pool` instance. Do not create a second Pool.

---

## Task 18: Phase registry — synthetic `custom-ai` definition

**Files:**
- Modify: `packages/phases/src/registry.ts`
- Create: `packages/phases/src/custom/custom-ai.tsx`

- [ ] **Step 1: Custom-ai phase definition**

`packages/phases/src/custom/custom-ai.tsx`:

```tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CustomAiConfig {
  customPhaseId: string;
  provider?: "claude" | "gemini" | "codex";
  mcpInstanceIds?: string[];
  skillIds?: string[];
}

export const customAiPhase: PhaseDefinition<CustomAiConfig> = {
  phaseType: "custom-ai",
  label: "Custom AI Phase",
  category: "Custom",
  description: "User-defined AI phase. Inputs/outputs and prompt are configured per definition.",
  color: "#a29bfe",
  icon: "🧩",
  defaultConfig: { customPhaseId: "" },
  configSchema: z.object({
    customPhaseId: z.string().min(1),
    provider: z.enum(["claude", "gemini", "codex"]).optional(),
    mcpInstanceIds: z.array(z.string()).optional(),
    skillIds: z.array(z.string()).optional(),
  }),
  configFields: {
    // Drawer is rendered by a custom component (see flow-editor changes);
    // empty configFields is fine because the drawer reads the live custom phase.
  },
  tabs: { io: "shown", mcp: "shown", skills: "shown", retry: "shown" },
  supportsSkills: true,
  slots: [
    { name: "ANTHROPIC_API_KEY", description: "Anthropic API key. Optional.", optional: true },
  ],
  summary: (c) => c.customPhaseId ? `custom:${c.customPhaseId.slice(0, 8)}` : "(no phase)",
  executor: { kind: "coding-cli", method: "runCustomPrompt" },
  // I/O is dynamic — populated by the flow editor from the live custom phase
  // definition; the static outputSchema here is intentionally empty.
  outputSchema: {},
};
```

- [ ] **Step 2: Register in built-ins**

In `packages/phases/src/registry.ts`:

```ts
import { customAiPhase } from "./custom/custom-ai.tsx";

export const builtInPhases: PhaseDefinition<any>[] = [
  // ...existing list...
  customAiPhase,
];
```

---

## Task 19: Web API client

**Files:**
- Create: `packages/web/src/api/customPhases.ts`

- [ ] **Step 1: Implement client**

```ts
import { apiFetch } from "./client.ts";
import type {
  CustomAiPhase,
  CustomAiPhaseCreateInput,
  CustomAiPhaseUpdateInput,
} from "@journeyman/core";

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/custom-phases`;
const orgBase  = (orgId: string) => `/api/orgs/${orgId}/custom-phases`;

export const customPhasesApi = {
  listMine: (orgId: string) =>
    apiFetch<CustomAiPhase[]>(userBase(orgId)),
  listOrg: (orgId: string) =>
    apiFetch<CustomAiPhase[]>(orgBase(orgId)),
  listVisible: (orgId: string) =>
    apiFetch<CustomAiPhase[]>(`${orgBase(orgId)}/visible`),

  createMine: (orgId: string, body: CustomAiPhaseCreateInput) =>
    apiFetch<CustomAiPhase>(userBase(orgId), { method: "POST", body }),
  createOrg: (orgId: string, body: CustomAiPhaseCreateInput) =>
    apiFetch<CustomAiPhase>(orgBase(orgId), { method: "POST", body }),

  update: (orgId: string, id: string, scope: "user" | "org", body: CustomAiPhaseUpdateInput) =>
    apiFetch<CustomAiPhase>(
      scope === "user" ? `${userBase(orgId)}/${id}` : `${orgBase(orgId)}/${id}`,
      { method: "PATCH", body },
    ),

  remove: (orgId: string, id: string, scope: "user" | "org") =>
    apiFetch<void>(
      scope === "user" ? `${userBase(orgId)}/${id}` : `${orgBase(orgId)}/${id}`,
      { method: "DELETE" },
    ),
};
```

(If `apiFetch` has a different signature in `client.ts`, adjust the wrapper to match — pattern in `packages/web/src/api/skills.ts`.)

---

## Task 20: Input fields editor

**Files:**
- Create: `packages/web/src/components/custom-phases/InputFieldsEditor.tsx`

- [ ] **Step 1: Implement component**

```tsx
import { useState } from "react";
import type { CustomPhaseInputField, CustomPhaseInputType } from "@journeyman/core";

const TYPES: CustomPhaseInputType[] = [
  "string", "number", "boolean", "string[]",
  "workspaceId", "repoRef", "issueRef",
];

export function InputFieldsEditor(props: {
  value: CustomPhaseInputField[];
  onChange: (next: CustomPhaseInputField[]) => void;
}) {
  const { value, onChange } = props;
  const update = (i: number, patch: Partial<CustomPhaseInputField>) => {
    onChange(value.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { name: "", type: "string", required: false }]);

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Required</th><th>Description</th><th></th>
          </tr>
        </thead>
        <tbody>
          {value.map((f, i) => (
            <tr key={i}>
              <td><input value={f.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
              <td>
                <select value={f.type} onChange={(e) => update(i, { type: e.target.value as CustomPhaseInputType })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td><input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} /></td>
              <td><input value={f.description ?? ""} onChange={(e) => update(i, { description: e.target.value })} /></td>
              <td><button type="button" onClick={() => remove(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={add}>+ Add field</button>
    </div>
  );
}
```

---

## Task 21: Output schema editor

**Files:**
- Create: `packages/web/src/components/custom-phases/OutputSchemaEditor.tsx`

- [ ] **Step 1: Implement component**

```tsx
import { useState } from "react";
import type { CustomPhaseOutputMode, CustomPhaseJsonSchema } from "@journeyman/core";

interface SchemaField {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  description?: string;
}

export function OutputSchemaEditor(props: {
  mode: CustomPhaseOutputMode;
  schema: CustomPhaseJsonSchema | undefined;
  onModeChange: (m: CustomPhaseOutputMode) => void;
  onSchemaChange: (s: CustomPhaseJsonSchema | undefined) => void;
}) {
  const { mode, schema, onModeChange, onSchemaChange } = props;
  const fields: SchemaField[] = parseSchema(schema);
  const update = (next: SchemaField[]) => onSchemaChange(buildSchema(next));

  return (
    <div>
      <label>Output mode: </label>
      <select value={mode} onChange={(e) => onModeChange(e.target.value as CustomPhaseOutputMode)}>
        <option value="none">None</option>
        <option value="text">Text</option>
        <option value="structured">Structured</option>
      </select>

      {mode === "structured" && (
        <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th><th></th></tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={i}>
                <td><input value={f.name} onChange={(e) => update(fields.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} /></td>
                <td>
                  <select value={f.type} onChange={(e) => update(fields.map((x, idx) => idx === i ? { ...x, type: e.target.value as SchemaField["type"] } : x))}>
                    <option>string</option><option>number</option><option>boolean</option>
                    <option>array</option><option>object</option>
                  </select>
                </td>
                <td><input type="checkbox" checked={f.required} onChange={(e) => update(fields.map((x, idx) => idx === i ? { ...x, required: e.target.checked } : x))} /></td>
                <td><input value={f.description ?? ""} onChange={(e) => update(fields.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} /></td>
                <td><button type="button" onClick={() => update(fields.filter((_, idx) => idx !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={5}><button type="button" onClick={() => update([...fields, { name: "", type: "string", required: false }])}>+ Add field</button></td></tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

function parseSchema(s: CustomPhaseJsonSchema | undefined): SchemaField[] {
  if (!s || typeof s !== "object") return [];
  const required = new Set<string>(Array.isArray((s as any).required) ? (s as any).required : []);
  const props = (s as any).properties ?? {};
  return Object.entries(props).map(([name, p]: [string, any]) => ({
    name,
    type: (p?.type ?? "string") as SchemaField["type"],
    required: required.has(name),
    description: p?.description,
  }));
}

function buildSchema(fields: SchemaField[]): CustomPhaseJsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    if (!f.name) continue;
    properties[f.name] = { type: f.type, ...(f.description ? { description: f.description } : {}) };
    if (f.required) required.push(f.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
```

---

## Task 22: Edit modal

**Files:**
- Create: `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx`

- [ ] **Step 1: Implement modal**

```tsx
import { useState } from "react";
import type {
  CustomAiPhase, CustomAiPhaseCreateInput, CustomPhaseInputField,
  CustomPhaseOutputMode, CustomPhaseJsonSchema,
} from "@journeyman/core";
import { InputFieldsEditor } from "./InputFieldsEditor.tsx";
import { OutputSchemaEditor } from "./OutputSchemaEditor.tsx";

export function EditCustomPhaseModal(props: {
  initial?: CustomAiPhase;
  scope: "user" | "org";
  onCancel: () => void;
  onSave: (body: CustomAiPhaseCreateInput) => Promise<void>;
}) {
  const { initial, scope, onCancel, onSave } = props;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [inputFields, setInputFields] = useState<CustomPhaseInputField[]>(initial?.inputFields ?? []);
  const [outputMode, setOutputMode] = useState<CustomPhaseOutputMode>(initial?.outputMode ?? "none");
  const [outputSchema, setOutputSchema] = useState<CustomPhaseJsonSchema | undefined>(initial?.outputSchema);
  const [promptTemplate, setPromptTemplate] = useState(initial?.promptTemplate ?? "");
  const [needsWorkspace, setNeedsWorkspace] = useState(initial?.needsWorkspace ?? false);
  const [defaultProvider, setDefaultProvider] = useState<string>(initial?.defaultProvider ?? "");
  const [defaultMcpIds, setDefaultMcpIds] = useState<string[]>(initial?.defaultMcpIds ?? []);
  const [defaultSkillIds, setDefaultSkillIds] = useState<string[]>(initial?.defaultSkillIds ?? []);

  const submit = async () => {
    await onSave({
      scope,
      name, description,
      inputFields,
      outputMode, outputSchema: outputMode === "structured" ? outputSchema : undefined,
      promptTemplate,
      needsWorkspace,
      defaultProvider: defaultProvider || undefined,
      defaultMcpIds, defaultSkillIds,
    });
  };

  return (
    <div className="modal">
      <h2>{initial ? "Edit" : "New"} custom phase ({scope})</h2>

      <section>
        <h3>Definition</h3>
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Description <textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </section>

      <section>
        <h3>Inputs</h3>
        <InputFieldsEditor value={inputFields} onChange={setInputFields} />
      </section>

      <section>
        <h3>Output</h3>
        <OutputSchemaEditor
          mode={outputMode}
          schema={outputSchema}
          onModeChange={setOutputMode}
          onSchemaChange={setOutputSchema}
        />
      </section>

      <section>
        <h3>Prompt</h3>
        <label>
          <input type="checkbox" checked={needsWorkspace} onChange={(e) => setNeedsWorkspace(e.target.checked)} />
          Needs workspace
        </label>
        <textarea
          rows={12}
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          placeholder="Use {{inputName}} to substitute input values"
        />
      </section>

      <section>
        <h3>Defaults</h3>
        <label>Provider
          <select value={defaultProvider} onChange={(e) => setDefaultProvider(e.target.value)}>
            <option value="">(none)</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        {/* MCP/skill multi-pickers reuse existing components from EditSkillsModal/AddCustomModal patterns */}
      </section>

      <footer>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" onClick={submit}>Save</button>
      </footer>
    </div>
  );
}
```

> **Lookup target:** `packages/web/src/components/skills/EditSkillsModal.tsx` and `AddCustomModal.tsx` — copy the MCP-instance and skill-package multi-picker components into the Defaults section. Both files already exist in the repo.

---

## Task 23: List component

**Files:**
- Create: `packages/web/src/components/custom-phases/CustomPhasesList.tsx`

- [ ] **Step 1: Implement list**

```tsx
import { useEffect, useState } from "react";
import type { CustomAiPhase, CustomAiPhaseCreateInput } from "@journeyman/core";
import { customPhasesApi } from "../../api/customPhases.ts";
import { EditCustomPhaseModal } from "./EditCustomPhaseModal.tsx";

export function CustomPhasesList(props: { orgId: string; scope: "user" | "org" }) {
  const { orgId, scope } = props;
  const [items, setItems] = useState<CustomAiPhase[]>([]);
  const [editing, setEditing] = useState<{ phase?: CustomAiPhase } | null>(null);

  const refresh = async () => {
    const list = scope === "user"
      ? await customPhasesApi.listMine(orgId)
      : await customPhasesApi.listOrg(orgId);
    setItems(list);
  };

  useEffect(() => { void refresh(); }, [orgId, scope]);

  const handleSave = async (body: CustomAiPhaseCreateInput) => {
    if (editing?.phase) {
      await customPhasesApi.update(orgId, editing.phase.id, scope, body);
    } else if (scope === "user") {
      await customPhasesApi.createMine(orgId, body);
    } else {
      await customPhasesApi.createOrg(orgId, body);
    }
    setEditing(null);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this custom phase?")) return;
    await customPhasesApi.remove(orgId, id, scope);
    await refresh();
  };

  return (
    <div>
      <button type="button" onClick={() => setEditing({})}>+ New custom phase</button>
      <table>
        <thead><tr><th>Name</th><th>Output</th><th>Workspace</th><th>Inputs</th><th></th></tr></thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.outputMode}</td>
              <td>{p.needsWorkspace ? "yes" : "no"}</td>
              <td>{p.inputFields.length}</td>
              <td>
                <button type="button" onClick={() => setEditing({ phase: p })}>Edit</button>
                <button type="button" onClick={() => handleDelete(p.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <EditCustomPhaseModal
          initial={editing.phase}
          scope={scope}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
```

---

## Task 24: Management pages

**Files:**
- Create: `packages/web/src/routes/MyCustomPhasesPage.tsx`
- Create: `packages/web/src/routes/AdminCustomPhasesPage.tsx`

- [ ] **Step 1: My page**

```tsx
import { CustomPhasesList } from "../components/custom-phases/CustomPhasesList.tsx";

export function MyCustomPhasesPage(props: { orgId: string }) {
  return (
    <div className="page">
      <h1>My Custom Phases</h1>
      <CustomPhasesList orgId={props.orgId} scope="user" />
    </div>
  );
}
```

- [ ] **Step 2: Admin page**

```tsx
import { CustomPhasesList } from "../components/custom-phases/CustomPhasesList.tsx";

export function AdminCustomPhasesPage(props: { orgId: string }) {
  return (
    <div className="page">
      <h1>Org Custom Phases</h1>
      <CustomPhasesList orgId={props.orgId} scope="org" />
    </div>
  );
}
```

---

## Task 25: Wire pages into App.tsx + sidebar

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: sidebar component (lookup `packages/web/src/components/sidebar/`)

- [ ] **Step 1: Routes**

In `packages/web/src/App.tsx`, alongside the skills routes:

```tsx
import { MyCustomPhasesPage } from "./routes/MyCustomPhasesPage.tsx";
import { AdminCustomPhasesPage } from "./routes/AdminCustomPhasesPage.tsx";

<Route path="/me/custom-phases" element={<MyCustomPhasesPage orgId={activeOrgId} />} />
<Route
  path="/admin/custom-phases"
  element={role === "admin" ? <AdminCustomPhasesPage orgId={activeOrgId} /> : <Navigate to="/" replace />}
/>
```

- [ ] **Step 2: Sidebar links**

Add to the sidebar nav (mirror the location of the existing `My Skills` and `Admin Skills` links):

```tsx
<NavLink to="/me/custom-phases">My Custom Phases</NavLink>
{role === "admin" && <NavLink to="/admin/custom-phases">Org Custom Phases</NavLink>}
```

> **Lookup target:** find where `/me/skills` and `/admin/skills` are listed in the sidebar component file under `packages/web/src/components/sidebar/`. Add the two new entries directly below.

---

## Task 26: Flow editor — Custom catalog category

**Files:**
- Modify: relevant file under `packages/flow-editor/src/catalogs/` (lookup target)
- Modify: `packages/flow-editor/src/state/` to fetch visible custom phases

- [ ] **Step 1: Fetch visible custom phases**

Add a hook (place beside existing flow-editor data hooks):

```ts
import { useEffect, useState } from "react";
import type { CustomAiPhase } from "@journeyman/core";

export function useVisibleCustomPhases(orgId: string) {
  const [items, setItems] = useState<CustomAiPhase[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/orgs/${orgId}/custom-phases/visible`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (alive) setItems(d); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [orgId]);
  return items;
}
```

- [ ] **Step 2: Inject Custom category entries**

Where the catalog panel renders entries by category (lookup `packages/flow-editor/src/catalogs/`), append entries for visible custom phases under a "Custom" section. Each entry creates a `custom-ai` node when dropped, with `customPhaseId` prefilled and defaults from the phase:

```tsx
const customPhases = useVisibleCustomPhases(orgId);

// In the catalog entries list builder, add:
const customEntries = customPhases.map((p) => ({
  category: "Custom",
  label: p.name,
  description: p.description,
  badge: p.scope,                     // 'user' | 'org'
  createNodeConfig: () => ({
    customPhaseId: p.id,
    provider: p.defaultProvider,
    mcpInstanceIds: p.defaultMcpIds,
    skillIds: p.defaultSkillIds,
  }),
  phaseType: "custom-ai",
  inputFields: p.inputFields,
  outputSchema: p.outputMode === "structured" ? p.outputSchema : (
    p.outputMode === "text" ? { type: "object", properties: { result: { type: "string" } } } : {}
  ),
}));
```

> **Lookup target:** open the catalog file in `packages/flow-editor/src/catalogs/` (it builds the palette items) and merge `customEntries` into the existing list. Adapt field names to whatever the local item type expects.

---

## Task 27: Flow editor — node config drawer for custom-ai

**Files:**
- Modify: relevant drawer file under `packages/flow-editor/src/properties-panel/` (lookup target)

- [ ] **Step 1: Render custom drawer**

When the selected node has `phaseType === "custom-ai"`, render a drawer that fetches the live custom phase and shows:

```tsx
import { useEffect, useState } from "react";
import type { CustomAiPhase } from "@journeyman/core";

export function CustomAiNodeDrawer(props: {
  orgId: string;
  config: { customPhaseId: string; provider?: string; mcpInstanceIds?: string[]; skillIds?: string[] };
  inputs: Record<string, unknown>;
  onChangeConfig: (next: typeof props.config) => void;
  onChangeInputs: (next: Record<string, unknown>) => void;
}) {
  const { orgId, config } = props;
  const [phase, setPhase] = useState<CustomAiPhase | null>(null);

  useEffect(() => {
    if (!config.customPhaseId) return;
    fetch(`/api/orgs/${orgId}/users/me/custom-phases/${config.customPhaseId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .catch(() =>
        fetch(`/api/orgs/${orgId}/custom-phases/${config.customPhaseId}`, { credentials: "include" })
          .then((r) => r.json()),
      )
      .then(setPhase);
  }, [orgId, config.customPhaseId]);

  if (!phase) return <div>Loading custom phase…</div>;

  return (
    <div>
      <h3>{phase.name}</h3>
      <a href={
        phase.scope === "user" ? "/me/custom-phases" : "/admin/custom-phases"
      } target="_blank" rel="noreferrer">Edit definition →</a>

      <h4>Inputs</h4>
      {phase.inputFields.map((f) => (
        <div key={f.name}>
          <label>{f.name} ({f.type}){f.required ? " *" : ""}</label>
          {/* Reuse existing per-type input wiring widget; this placeholder
              must be replaced with the actual control used by other phases.
              Lookup target: packages/flow-editor/src/properties-panel/<input-binding-component>. */}
        </div>
      ))}

      <h4>Provider</h4>
      <select
        value={props.config.provider ?? ""}
        onChange={(e) => props.onChangeConfig({ ...config, provider: (e.target.value || undefined) as any })}
      >
        <option value="">(default)</option>
        <option value="claude">Claude</option>
        <option value="gemini">Gemini</option>
        <option value="codex">Codex</option>
      </select>

      <h4>Output preview</h4>
      <pre>{JSON.stringify(
        phase.outputMode === "structured" ? phase.outputSchema :
        phase.outputMode === "text" ? { result: "string" } : {}, null, 2)}</pre>

      {/* MCP / skill pickers — reuse the same components used by analyze/plan/implement node drawers. */}
    </div>
  );
}
```

> **Lookup target:** `packages/flow-editor/src/properties-panel/` — find how the analyze/plan/implement drawers render input bindings, MCP picker, skill picker. Use the same components inside this drawer.

---

## Task 28: Schema-break detection in the editor

**Files:**
- Modify: a state hook in `packages/flow-editor/src/state/` (lookup target)

- [ ] **Step 1: Diff hook**

When loading a flow, for every `custom-ai` node, fetch the current definition, compare against the saved wiring, and surface diffs. The package `@journeyman/custom-phases` already exports `diffCustomPhase`.

```ts
import { diffCustomPhase, type CustomPhaseDiff } from "@journeyman/custom-phases";

export async function detectCustomPhaseBreaks(
  orgId: string,
  nodes: Array<{
    id: string;
    phaseType: string;
    config: { customPhaseId?: string };
    snapshot?: { phase: import("@journeyman/core").CustomAiPhase };
    wiredInputs: string[];
    wiredOutputPaths: string[];
  }>,
): Promise<Map<string, CustomPhaseDiff>> {
  const out = new Map<string, CustomPhaseDiff>();
  for (const n of nodes) {
    if (n.phaseType !== "custom-ai" || !n.config.customPhaseId) continue;
    const r = await fetch(`/api/orgs/${orgId}/custom-phases/${n.config.customPhaseId}`, { credentials: "include" });
    if (!r.ok) continue;
    const next = await r.json();
    const prev = n.snapshot?.phase ?? next; // first run: no diff
    out.set(n.id, diffCustomPhase(prev, next, {
      wiredInputs: n.wiredInputs,
      wiredOutputPaths: n.wiredOutputPaths,
    }));
  }
  return out;
}
```

The flow editor canvas should:
- Mark a node red when `inputErrors.length + outputErrors.length > 0`.
- Mark a node amber when only `outputWarnings.length > 0`.
- Show a top banner aggregating the error count.
- Block the run button while any node has errors (saving stays allowed).

> **Lookup target:** the existing flow-editor "node validation" / "errors panel" code under `packages/flow-editor/src/state/`. Wire `detectCustomPhaseBreaks` results into that pipeline.

---

## Task 29: Snapshot the custom phase definition on flow save

**Files:**
- Modify: the flow-save serializer (lookup `packages/flow-editor/src/state/flow-graph.ts` or equivalent)

- [ ] **Step 1: Embed snapshot in node**

When serialising a flow that contains `custom-ai` nodes, attach a `customPhaseSnapshot` to each node — the definition as it was at save time. The schema-diff hook (Task 28) uses this as the `prev` value to detect what changed since save.

```ts
// pseudo-code at save time:
for (const node of nodes) {
  if (node.phaseType === "custom-ai" && node.config.customPhaseId) {
    const r = await fetch(`/api/orgs/${orgId}/custom-phases/${node.config.customPhaseId}`, { credentials: "include" });
    if (r.ok) {
      node.customPhaseSnapshot = await r.json();
    }
  }
}
```

> **Lookup target:** the flow-save path that converts the editor state to JSON. Add the snapshot field there. The orchestrator does not need this snapshot — it always loads the live definition.

---

## Task 30: Add `@journeyman/custom-phases` workspace recognition

**Files:**
- Modify: root `package.json` if `workspaces` is not the default `packages/*` glob

- [ ] **Step 1: Verify**

Open root `package.json`. If `workspaces` is `["packages/*"]`, no changes needed — `npm install` will pick up the new package automatically.

If `workspaces` lists explicit packages, add `"packages/custom-phases"`.

- [ ] **Step 2: Install**

Run from repo root:

```bash
npm install
```

Expected: no errors; `node_modules/@journeyman/custom-phases` symlink exists.

---

## Task 31: Final typecheck

**Files:** none

- [ ] **Step 1: Typecheck whole monorepo**

Run from repo root:

```bash
npm run typecheck
```

Expected: zero errors. If errors appear:
- For missing-method errors on `ICodingCLI`: re-check the `runCustomPrompt` stubs in Gemini/Codex (Task 5).
- For missing imports from `@journeyman/custom-phases`: verify `package.json` exports map (Task 6) and barrel exports (Task 6 step 3).
- For `pg` Pool type mismatches in the orchestrator: ensure the same Pool instance is passed to `CustomAiPhaseHandler` (Task 17 lookup target).
- For React/JSX errors in `packages/web`: confirm `EditCustomPhaseModal` and `CustomPhasesList` use the same imports/aliases as the existing skills components.

---

## Self-review checklist

- ✅ DB migration matches data-model section of spec.
- ✅ Per-user, per-org, and visible routes mirror the skills routes (the spec said "mirrors skills" — same `/api/orgs/:orgId/...` shape).
- ✅ `runCustomPrompt` flows through `ICodingCLI` per spec.
- ✅ Orchestrator handler loads definition by id, renders prompt, dispatches to provider, maps result by `outputMode`.
- ✅ Flow editor: catalog category, node drawer, schema-break diff, snapshot on save — all covered (Tasks 26–29).
- ✅ Management pages mirror `MySkillsPage`/`AdminSkillsPage`.
- ✅ No commits, no unit tests, single typecheck at the end — matches user constraints.
- ⚠️ `mcpsToConfig` / `skillsToConfig` placeholders in Task 4 — explicitly flagged with a lookup target so the implementer copies the proven shape from `analyze.ts`. Not a placeholder for behaviour, but a copy-from-existing instruction.
- ⚠️ Sidebar/Catalog/Drawer "lookup target" notes — these are intentional; the precise file paths shift across versions of `flow-editor`. The implementer reads two adjacent existing entries and adds the new one in the same shape.

---

## Open questions deferred to follow-ups (per spec § Open Questions)

- Conditional/loop prompt templating.
- "Clone to org" / "Clone from org" affordances.
- Confirming the org-admin write gate against the live permission model (Task 12 uses `requireAuth({ role: "admin" })`, mirroring `org-skills.ts`; verify this matches how org-skills are gated today).
