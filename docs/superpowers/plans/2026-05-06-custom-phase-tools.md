# Custom Phase Tool Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `needs_workspace` with an explicit, canonical tool list on custom AI phases — definition default plus per-node override — and translate canonical names to provider-native tool names per coding-cli provider (Claude / Gemini / Codex / OpenCode).

**Architecture:** A canonical tool vocabulary lives in `@journeyman/core`. Each provider package owns a translation table from canonical names to native tool names (or `null` for unsupported). The custom-phase definition gets a `defaultTools` field; flow nodes carry an optional `tools` override. The orchestrator handler derives workspace requirement from the effective tool list. The flow editor flags provider × tool incompatibilities.

**Tech Stack:** TypeScript, npm workspaces, PostgreSQL, React (flow editor + admin pages), Claude Agent SDK.

**User constraints for this plan:** No commits. No unit tests. End with a typecheck of the whole monorepo.

**Spec:** [docs/superpowers/specs/2026-05-06-custom-phase-tools-design.md](../specs/2026-05-06-custom-phase-tools-design.md)

---

## File Structure

**New files**
- `packages/core/src/types/coding-tools.types.ts` — canonical tool vocabulary, helpers
- `packages/coding-cli/src/providers/claude/tool-mapping.ts` — Claude tool map
- `packages/coding-cli/src/providers/gemini/tool-mapping.ts` — Gemini tool map (stub)
- `packages/coding-cli/src/providers/codex/tool-mapping.ts` — Codex tool map (stub)
- `packages/coding-cli/src/providers/opencode/tool-mapping.ts` — OpenCode tool map (stub)
- `packages/coding-cli/src/providers/tool-maps.ts` — re-export + `unsupportedTools(provider, tools)` helper
- `packages/migrations/src/sql/014_custom_phase_default_tools.sql` — schema migration
- `packages/web/src/components/custom-phases/ToolsPicker.tsx` — checkbox picker reused by definition + node drawer

**Modified files**
- `packages/core/src/types/coding.types.ts` — `RunCustomPromptOptions.tools` replaces `allowedTools`
- `packages/core/src/types/custom-phases.types.ts` — drop `needsWorkspace`, add `defaultTools`
- `packages/core/src/index.ts` — export new tool types
- `packages/custom-phases/src/db.ts` — column rename in INSERT/UPDATE/SELECT
- `packages/custom-phases/src/catalog.ts` — drop `needsWorkspace`, add `defaultTools`
- `packages/custom-phases/src/routes/user-custom-phases.ts` — drop/add field, validate `default_tools`
- `packages/custom-phases/src/routes/org-custom-phases.ts` — same
- `packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts` — derive workspace from effective tools
- `packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts` — translate canonical → native
- `packages/coding-cli/src/providers/gemini/index.ts` — accept new `tools` field in stub
- `packages/coding-cli/src/providers/codex/index.ts` — same
- `packages/coding-cli/src/providers/opencode/index.ts` — same
- `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx` — replace `needsWorkspace` toggle with Tools section
- `packages/web/src/components/custom-phases/CustomPhasesList.tsx` — drop `needsWorkspace` column (or replace with tool-count badge)
- `packages/web/src/flow-editor-integration/customCatalogEntries.ts` — drop `needsWorkspace`, add `defaultTools`
- `packages/web/src/flow-editor-integration/CustomAiNodeDrawer.tsx` — add Tools section with override + provider × tool validation

---

## Task 1: Add canonical tool vocabulary in `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/coding-tools.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1.1: Create canonical tools module**

Create `packages/core/src/types/coding-tools.types.ts`:

```ts
// Canonical, provider-agnostic tool vocabulary used by custom AI phases.
// Each coding-cli provider owns a mapping from these names to its native tool
// names. See packages/coding-cli/src/providers/*/tool-mapping.ts.

export const CANONICAL_TOOLS = [
  "bash",
  "read-file",
  "write-file",
  "edit-file",
  "search",
  "web-fetch",
  "web-search",
] as const;

export type CanonicalTool = (typeof CANONICAL_TOOLS)[number];

export const WORKSPACE_TOOLS: readonly CanonicalTool[] = [
  "bash",
  "read-file",
  "write-file",
  "edit-file",
  "search",
] as const;

export function isCanonicalTool(value: unknown): value is CanonicalTool {
  return typeof value === "string" && (CANONICAL_TOOLS as readonly string[]).includes(value);
}

export function toolsRequireWorkspace(tools: readonly CanonicalTool[]): boolean {
  return tools.some((t) => (WORKSPACE_TOOLS as readonly string[]).includes(t));
}

export function dedupeTools(tools: readonly CanonicalTool[]): CanonicalTool[] {
  return Array.from(new Set(tools));
}

// A provider's mapping table. `null` marks an unsupported tool on that
// provider; the editor uses this to flag node configs as broken.
export type ProviderToolMap = Record<CanonicalTool, string[] | null>;
```

- [ ] **Step 1.2: Re-export from package root**

In `packages/core/src/index.ts`, add an export line near the other `types/*` exports:

```ts
export * from "./types/coding-tools.types.ts";
```

(Match the style of the surrounding `export * from "./types/...";` lines exactly — same quote style, same `.ts` extension if the file uses it.)

---

## Task 2: Update `RunCustomPromptOptions` to use the canonical type

**Files:**
- Modify: `packages/core/src/types/coding.types.ts:201-212`

- [ ] **Step 2.1: Replace `allowedTools` with `tools: CanonicalTool[]`**

At the top of `packages/core/src/types/coding.types.ts`, add the import (group with existing local type imports):

```ts
import type { CanonicalTool } from "./coding-tools.types.ts";
```

Then replace the existing `RunCustomPromptOptions` interface (currently at lines 201–212) with:

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
}
```

(`RunCustomPromptResult` below it is unchanged.)

---

## Task 3: Update `CustomAiPhase` types — drop `needsWorkspace`, add `defaultTools`

**Files:**
- Modify: `packages/core/src/types/custom-phases.types.ts`

- [ ] **Step 3.1: Edit type definitions**

In `packages/core/src/types/custom-phases.types.ts`:

Add the import at the top of the file:

```ts
import type { CanonicalTool } from "./coding-tools.types.ts";
```

Replace the `CustomAiPhase` interface (currently lines 21–39) with:

```ts
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
  defaultTools: CanonicalTool[];
  defaultProvider?: string;
  defaultMcpIds: string[];
  defaultSkillIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

Replace the `CustomAiPhaseCreateInput` interface (currently lines 41–53) with:

```ts
export interface CustomAiPhaseCreateInput {
  scope: CustomPhaseScope;
  name: string;
  description?: string;
  inputFields?: CustomPhaseInputField[];
  outputMode?: CustomPhaseOutputMode;
  outputSchema?: CustomPhaseJsonSchema;
  promptTemplate?: string;
  defaultTools?: CanonicalTool[];
  defaultProvider?: string;
  defaultMcpIds?: string[];
  defaultSkillIds?: string[];
}
```

(`CustomAiPhaseUpdateInput` line below is unchanged — `Partial<Omit<…, "scope">>` picks up the new field automatically.)

---

## Task 4: SQL migration

**Files:**
- Create: `packages/migrations/src/sql/014_custom_phase_default_tools.sql`

- [ ] **Step 4.1: Write migration**

Create `packages/migrations/src/sql/014_custom_phase_default_tools.sql`:

```sql
-- 014_custom_phase_default_tools.sql
-- Replace boolean needs_workspace with explicit canonical-tool list.

ALTER TABLE jm_custom_ai_phases
  ADD COLUMN default_tools JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Preserve behavior: needs_workspace=true was sugar for "enable bash".
UPDATE jm_custom_ai_phases
   SET default_tools = '["bash"]'::jsonb
 WHERE needs_workspace = true;

ALTER TABLE jm_custom_ai_phases
  DROP COLUMN needs_workspace;
```

---

## Task 5: Update `custom-phases` DB layer

**Files:**
- Modify: `packages/custom-phases/src/db.ts`

- [ ] **Step 5.1: Update row mapper, INSERT, UPDATE**

In `packages/custom-phases/src/db.ts`:

Replace the line:

```ts
needsWorkspace: r.needs_workspace,
```

with:

```ts
defaultTools: Array.isArray(r.default_tools) ? r.default_tools : [],
```

In the `createCustomAiPhase` (or equivalent) INSERT statement, change the column list from `…, prompt_template, needs_workspace, …` to `…, prompt_template, default_tools, …` and the corresponding parameter from `input.needsWorkspace ?? false` to `JSON.stringify(input.defaultTools ?? [])`.

In the patch-builder section (around line 130), replace:

```ts
if (patch.needsWorkspace !== undefined)  push("needs_workspace", patch.needsWorkspace);
```

with:

```ts
if (patch.defaultTools !== undefined)
  push("default_tools", JSON.stringify(patch.defaultTools));
```

If the SELECT clause anywhere in the file lists columns explicitly (rather than `SELECT *`), update those clauses the same way: drop `needs_workspace`, add `default_tools`.

---

## Task 6: Update API routes — validate `default_tools`

**Files:**
- Modify: `packages/custom-phases/src/routes/user-custom-phases.ts`
- Modify: `packages/custom-phases/src/routes/org-custom-phases.ts`

- [ ] **Step 6.1: Replace field handling and add validation**

In both route files:

Add an import at the top:

```ts
import { CANONICAL_TOOLS, isCanonicalTool, type CanonicalTool } from "@journeyman/core";
```

Add a validator helper near the top of each file (or in a shared util if both files share one — match the existing style; if they don't share, duplicate):

```ts
function parseDefaultTools(raw: unknown): CanonicalTool[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("defaultTools must be an array of canonical tool names");
  }
  const seen = new Set<string>();
  for (const t of raw) {
    if (!isCanonicalTool(t)) {
      throw new Error(
        `defaultTools contains invalid tool '${String(t)}'. ` +
          `Allowed: ${CANONICAL_TOOLS.join(", ")}`,
      );
    }
    if (seen.has(t)) throw new Error(`defaultTools contains duplicate '${t}'`);
    seen.add(t);
  }
  return raw as CanonicalTool[];
}
```

Find the create handler (around `needsWorkspace: body.needsWorkspace`) and replace that property with:

```ts
defaultTools: parseDefaultTools(body.defaultTools),
```

Do the same in the update/patch handler if it currently passes `needsWorkspace`. If `body.defaultTools` is undefined on patch, omit the field instead of defaulting (so partial updates don't reset it):

```ts
...(body.defaultTools !== undefined ? { defaultTools: parseDefaultTools(body.defaultTools) } : {}),
```

---

## Task 7: Update catalog mapper

**Files:**
- Modify: `packages/custom-phases/src/catalog.ts`

- [ ] **Step 7.1: Swap field**

In `packages/custom-phases/src/catalog.ts`:

Add at top (if not already importing from `@journeyman/core`):

```ts
import type { CanonicalTool } from "@journeyman/core";
```

Find the catalog-entry interface (around line 15: `needsWorkspace: boolean;`) and replace that line with:

```ts
defaultTools: CanonicalTool[];
```

In the mapper function (around line 36) replace:

```ts
needsWorkspace: p.needsWorkspace,
```

with:

```ts
defaultTools: p.defaultTools,
```

---

## Task 8: Update orchestrator handler — derive workspace from tools

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts`

- [ ] **Step 8.1: Replace workspace-derivation block**

In `packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts`:

Update the `@journeyman/core` import to add the helpers:

```ts
import {
  createLogger,
  toolsRequireWorkspace,
  type CanonicalTool,
  type ICodingCLI,
  type IPhaseHandler,
  type PhaseContext,
  type PhaseInput,
  type PhaseRunResult,
  type ResolvedMcpInstance,
  type ResolvedSkillPackage,
} from "@journeyman/core";
```

Replace the block that currently reads (lines ~65–79):

```ts
const cwd = phase.needsWorkspace
  ? (typeof input.workspaceId === "string"
      ? input.workspaceId
      : (typeof input.workspaceDir === "string" ? input.workspaceDir : undefined))
  : undefined;
if (phase.needsWorkspace && !cwd) {
  return {
    kind: "failure",
    failure: {
      errorClass: "InvalidInput",
      message: "needs_workspace=true but no workspaceId/workspaceDir input was wired",
      retryable: false,
    },
  };
}
```

with:

```ts
const nodeTools = Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) : undefined;
const effectiveTools: CanonicalTool[] = nodeTools ?? phase.defaultTools ?? [];
const needsWorkspace = toolsRequireWorkspace(effectiveTools);

const cwd = needsWorkspace
  ? (typeof input.workspaceId === "string"
      ? input.workspaceId
      : (typeof input.workspaceDir === "string" ? input.workspaceDir : undefined))
  : undefined;
if (needsWorkspace && !cwd) {
  return {
    kind: "failure",
    failure: {
      errorClass: "InvalidInput",
      message:
        "Custom phase selected workspace tools (bash/read-file/write-file/edit-file/search) " +
        "but no workspaceId/workspaceDir input was wired",
      retryable: false,
    },
  };
}
```

In the `coding.runCustomPrompt({ ... })` call below, add the tools field. Find the existing call (around line 90) and update it to pass `tools: effectiveTools`:

```ts
const result = await coding.runCustomPrompt({
  prompt,
  outputMode: phase.outputMode,
  outputSchema: phase.outputSchema,
  cwd,
  mcps,
  skills,
  tools: effectiveTools,
  sessionId: ctx.runId,
  signal: ctx.signal,
  ...(model ? { model } : {}),
});
```

---

## Task 9: Add per-provider tool-map modules

**Files:**
- Create: `packages/coding-cli/src/providers/claude/tool-mapping.ts`
- Create: `packages/coding-cli/src/providers/gemini/tool-mapping.ts`
- Create: `packages/coding-cli/src/providers/codex/tool-mapping.ts`
- Create: `packages/coding-cli/src/providers/opencode/tool-mapping.ts`
- Create: `packages/coding-cli/src/providers/tool-maps.ts`

- [ ] **Step 9.1: Claude map (full)**

Create `packages/coding-cli/src/providers/claude/tool-mapping.ts`:

```ts
import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";

export const CLAUDE_TOOL_MAP: ProviderToolMap = {
  "bash":       ["Bash"],
  "read-file":  ["Read"],
  "write-file": ["Write"],
  "edit-file":  ["Edit"],
  "search":     ["Grep", "Glob"],
  "web-fetch":  ["WebFetch"],
  "web-search": ["WebSearch"],
};

export function claudeNativeTools(tools: readonly CanonicalTool[]): string[] {
  const out: string[] = [];
  for (const t of tools) {
    const native = CLAUDE_TOOL_MAP[t];
    if (native) out.push(...native);
  }
  return Array.from(new Set(out));
}
```

- [ ] **Step 9.2: Gemini stub map**

Create `packages/coding-cli/src/providers/gemini/tool-mapping.ts`:

```ts
import type { ProviderToolMap } from "@journeyman/core";

// Stub map — every tool is currently unsupported on Gemini until the adapter
// lands. The flow editor uses null entries to flag node configs as broken
// when the user picks Gemini with these tools selected.
export const GEMINI_TOOL_MAP: ProviderToolMap = {
  "bash":       null,
  "read-file":  null,
  "write-file": null,
  "edit-file":  null,
  "search":     null,
  "web-fetch":  null,
  "web-search": null,
};
```

- [ ] **Step 9.3: Codex stub map**

Create `packages/coding-cli/src/providers/codex/tool-mapping.ts` with the same structure as Gemini, named `CODEX_TOOL_MAP`.

```ts
import type { ProviderToolMap } from "@journeyman/core";

export const CODEX_TOOL_MAP: ProviderToolMap = {
  "bash":       null,
  "read-file":  null,
  "write-file": null,
  "edit-file":  null,
  "search":     null,
  "web-fetch":  null,
  "web-search": null,
};
```

- [ ] **Step 9.4: OpenCode stub map**

Create `packages/coding-cli/src/providers/opencode/tool-mapping.ts`:

```ts
import type { ProviderToolMap } from "@journeyman/core";

export const OPENCODE_TOOL_MAP: ProviderToolMap = {
  "bash":       null,
  "read-file":  null,
  "write-file": null,
  "edit-file":  null,
  "search":     null,
  "web-fetch":  null,
  "web-search": null,
};
```

- [ ] **Step 9.5: Aggregator + helper**

Create `packages/coding-cli/src/providers/tool-maps.ts`:

```ts
import type { CanonicalTool, ProviderToolMap } from "@journeyman/core";
import { CLAUDE_TOOL_MAP } from "./claude/tool-mapping.ts";
import { GEMINI_TOOL_MAP } from "./gemini/tool-mapping.ts";
import { CODEX_TOOL_MAP } from "./codex/tool-mapping.ts";
import { OPENCODE_TOOL_MAP } from "./opencode/tool-mapping.ts";

export type ProviderId = "claude" | "gemini" | "codex" | "opencode";

export const PROVIDER_TOOL_MAPS: Record<ProviderId, ProviderToolMap> = {
  claude:   CLAUDE_TOOL_MAP,
  gemini:   GEMINI_TOOL_MAP,
  codex:    CODEX_TOOL_MAP,
  opencode: OPENCODE_TOOL_MAP,
};

export function unsupportedTools(
  provider: ProviderId,
  tools: readonly CanonicalTool[],
): CanonicalTool[] {
  const map = PROVIDER_TOOL_MAPS[provider];
  if (!map) return [];
  return tools.filter((t) => map[t] === null);
}
```

- [ ] **Step 9.6: Re-export from coding-cli root**

Open `packages/coding-cli/src/index.ts` and add an export near the other re-exports (match existing style):

```ts
export { PROVIDER_TOOL_MAPS, unsupportedTools, type ProviderId } from "./providers/tool-maps.ts";
```

---

## Task 10: Claude provider — translate canonical → native

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts:48-49`

- [ ] **Step 10.1: Replace baseTools resolution**

In `packages/coding-cli/src/providers/claude/operations/run-custom-prompt.ts`:

Add an import near the existing local imports:

```ts
import { claudeNativeTools } from "../tool-mapping.ts";
```

Replace these lines (currently lines 47–49):

```ts
const useTools = Boolean(opts.cwd);
const baseTools = useTools ? (opts.allowedTools ?? ["Bash", "Read", "Glob", "Grep", "Write"]) : [];
const tools = [...baseTools, ...mcpToolNames];
```

with:

```ts
const canonicalTools = opts.tools ?? [];
const baseTools = claudeNativeTools(canonicalTools);
const useTools = baseTools.length > 0 || (mcpToolNames.length > 0 && Boolean(opts.cwd));
const tools = [...baseTools, ...mcpToolNames];
```

The `useTools` flag is no longer used downstream as a gate — verify by searching the rest of the file for `useTools`. If it gates `cwd` inclusion or anything else, leave that gate intact; otherwise remove the unused `const useTools` line. The query options below already use `opts.cwd` directly, so the only consumer is likely just the old `baseTools` ternary (which we replaced).

If the resulting `tools` array is empty, omit `tools` and `allowedTools` from `queryOptions` to preserve the minimal-config pattern. Update the existing `queryOptions` literal — find:

```ts
const queryOptions: Record<string, unknown> = {
  tools,
  allowedTools: tools,
  permissionMode: "bypassPermissions",
  ...
```

and change the first two lines to spread-conditionally:

```ts
const queryOptions: Record<string, unknown> = {
  ...(tools.length ? { tools, allowedTools: tools } : {}),
  permissionMode: "bypassPermissions",
  ...
```

---

## Task 11: Stub providers — accept the new field

**Files:**
- Modify: `packages/coding-cli/src/providers/gemini/index.ts:35`
- Modify: `packages/coding-cli/src/providers/codex/index.ts:35`
- Modify: `packages/coding-cli/src/providers/opencode/index.ts:79-80`

- [ ] **Step 11.1: Verify signatures still match**

These providers all currently throw `not implemented`. Because we replaced `allowedTools` with `tools` in `RunCustomPromptOptions` (Task 2), the type system will already accept the new shape — no code change is strictly required, but inspect each `runCustomPrompt(_opts: RunCustomPromptOptions)` line and ensure no provider references `_opts.allowedTools`. (At time of writing, none do.)

If any provider destructures `allowedTools`, rename it to `tools`. Otherwise leave as-is.

---

## Task 12: Definition editor — replace `needsWorkspace` toggle with Tools picker

**Files:**
- Create: `packages/web/src/components/custom-phases/ToolsPicker.tsx`
- Modify: `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx`

- [ ] **Step 12.1: Build the reusable Tools picker**

Create `packages/web/src/components/custom-phases/ToolsPicker.tsx`:

```tsx
import { CANONICAL_TOOLS, WORKSPACE_TOOLS, type CanonicalTool } from "@journeyman/core";

const TOOL_DESCRIPTIONS: Record<CanonicalTool, string> = {
  "bash":       "Run shell commands",
  "read-file":  "Read files in the workspace",
  "write-file": "Create or overwrite files",
  "edit-file":  "Patch existing files",
  "search":     "Find files by name or content (grep + glob)",
  "web-fetch":  "Fetch a URL",
  "web-search": "Search the web",
};

export function ToolsPicker(props: {
  value: CanonicalTool[];
  onChange: (next: CanonicalTool[]) => void;
  disabledTools?: ReadonlySet<CanonicalTool>;
  unsupportedTools?: ReadonlySet<CanonicalTool>;
}) {
  const selected = new Set(props.value);
  const ws = new Set<string>(WORKSPACE_TOOLS);

  const toggle = (t: CanonicalTool) => {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    props.onChange(CANONICAL_TOOLS.filter((c) => next.has(c)));
  };

  return (
    <div className="space-y-1">
      {CANONICAL_TOOLS.map((t) => {
        const isWorkspace = ws.has(t);
        const unsupported = props.unsupportedTools?.has(t);
        const disabled = props.disabledTools?.has(t);
        return (
          <label
            key={t}
            className={`flex items-center gap-2 text-xs ${unsupported ? "text-rose-300" : "text-slate-300"}`}
          >
            <input
              type="checkbox"
              className="accent-indigo-500"
              checked={selected.has(t)}
              disabled={disabled}
              onChange={() => toggle(t)}
            />
            <code className="text-slate-200">{t}</code>
            <span className="text-slate-400">— {TOOL_DESCRIPTIONS[t]}</span>
            {isWorkspace && (
              <span className="text-[10px] uppercase tracking-wide text-slate-500">workspace</span>
            )}
            {unsupported && (
              <span className="text-[10px] uppercase tracking-wide text-rose-400">
                not supported by selected provider
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 12.2: Swap the toggle for the picker in EditCustomPhaseModal**

In `packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx`:

Update the imports near the top to include the new types and component:

```tsx
import type {
  CustomAiPhase, CustomAiPhaseCreateInput, CustomPhaseInputField,
  CustomPhaseOutputMode, CustomPhaseJsonSchema,
  CanonicalTool,
} from "@journeyman/core";
import { toolsRequireWorkspace } from "@journeyman/core";
import { ToolsPicker } from "./ToolsPicker.tsx";
```

Replace the line:

```tsx
const [needsWorkspace, setNeedsWorkspace] = useState(initial?.needsWorkspace ?? false);
```

with:

```tsx
const [defaultTools, setDefaultTools] = useState<CanonicalTool[]>(initial?.defaultTools ?? []);
```

Replace the property in the `onSave({ ... })` payload:

```tsx
needsWorkspace,
```

with:

```tsx
defaultTools,
```

Replace the JSX block that currently renders the checkbox + label (lines 100–108):

```tsx
<label className="flex items-center gap-2 text-xs text-slate-300">
  <input
    type="checkbox"
    className="accent-indigo-500"
    checked={needsWorkspace}
    onChange={(e) => setNeedsWorkspace(e.target.checked)}
  />
  Needs workspace (gives the agent a cwd + Bash tools)
</label>
```

with nothing (delete it). Then add a new `<section>` immediately after the `<section>` that contains the `OutputSchemaEditor` (i.e. between Output and Prompt):

```tsx
<section className="space-y-3">
  <h3 className="text-sm font-medium text-slate-200">Tools</h3>
  <ToolsPicker value={defaultTools} onChange={setDefaultTools} />
  {toolsRequireWorkspace(defaultTools) && (
    <p className="text-[11px] text-slate-400">
      A workspace tool is selected — flows using this phase must wire a{" "}
      <code>workspaceId</code> input.
    </p>
  )}
</section>
```

---

## Task 13: Update CustomPhasesList display

**Files:**
- Modify: `packages/web/src/components/custom-phases/CustomPhasesList.tsx:96`

- [ ] **Step 13.1: Swap the column**

In `packages/web/src/components/custom-phases/CustomPhasesList.tsx`, find the cell currently rendering:

```tsx
{p.needsWorkspace ? "yes" : "no"}
```

Replace it with:

```tsx
{p.defaultTools.length === 0 ? "—" : p.defaultTools.join(", ")}
```

If the column header above this cell says "Needs workspace" (or similar), rename it to "Tools".

---

## Task 14: Update flow-editor catalog entries

**Files:**
- Modify: `packages/web/src/flow-editor-integration/customCatalogEntries.ts`

- [ ] **Step 14.1: Swap field**

In `packages/web/src/flow-editor-integration/customCatalogEntries.ts`:

Update the import:

```ts
import type { CustomAiPhase, CanonicalTool } from "@journeyman/core";
```

In the `CustomPhaseCatalogEntry` interface, replace:

```ts
needsWorkspace: boolean;
```

with:

```ts
defaultTools: CanonicalTool[];
```

In the mapper, replace:

```ts
needsWorkspace: p.needsWorkspace,
```

with:

```ts
defaultTools: p.defaultTools,
```

---

## Task 15: Flow-editor node drawer — Tools section + provider × tool validation

**Files:**
- Modify: `packages/web/src/flow-editor-integration/CustomAiNodeDrawer.tsx`

- [ ] **Step 15.1: Extend config + render Tools section**

Replace the entire contents of `packages/web/src/flow-editor-integration/CustomAiNodeDrawer.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { CustomAiPhase, CanonicalTool } from "@journeyman/core";
import { toolsRequireWorkspace } from "@journeyman/core";
import { unsupportedTools, type ProviderId } from "@journeyman/coding-cli";
import { ToolsPicker } from "../components/custom-phases/ToolsPicker.tsx";

interface CustomAiNodeConfig {
  customPhaseId: string;
  provider?: ProviderId;
  mcpInstanceIds?: string[];
  skillIds?: string[];
  tools?: CanonicalTool[];
}

export function CustomAiNodeDrawer(props: {
  orgId: string;
  config: CustomAiNodeConfig;
  onChangeConfig: (next: CustomAiNodeConfig) => void;
}) {
  const { orgId, config } = props;
  const [phase, setPhase] = useState<CustomAiPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState<boolean>(config.tools !== undefined);

  useEffect(() => {
    if (!config.customPhaseId) return;
    let alive = true;
    fetch(`/api/orgs/${orgId}/users/me/custom-phases/${config.customPhaseId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .catch(() =>
        fetch(`/api/orgs/${orgId}/custom-phases/${config.customPhaseId}`, { credentials: "include" })
          .then((r) => (r.ok ? r.json() : Promise.reject(r))),
      )
      .then((p) => { if (alive) setPhase(p as CustomAiPhase); })
      .catch((err) => { if (alive) setError(String(err)); });
    return () => { alive = false; };
  }, [orgId, config.customPhaseId]);

  const effectiveTools: CanonicalTool[] = useMemo(
    () => config.tools ?? phase?.defaultTools ?? [],
    [config.tools, phase?.defaultTools],
  );

  const effectiveProvider: ProviderId | undefined =
    (config.provider ?? (phase?.defaultProvider as ProviderId | undefined)) || undefined;

  const unsupported = useMemo(() => {
    if (!effectiveProvider) return new Set<CanonicalTool>();
    return new Set(unsupportedTools(effectiveProvider, effectiveTools));
  }, [effectiveProvider, effectiveTools]);

  if (error) return <div style={{ color: "red" }}>{error}</div>;
  if (!phase) return <div>Loading custom phase…</div>;

  const editHref = phase.scope === "user" ? "/me/custom-phases" : "/admin/custom-phases";
  const needsWs = toolsRequireWorkspace(effectiveTools);

  return (
    <div>
      <h3>{phase.name}</h3>
      <a href={editHref} target="_blank" rel="noreferrer">Edit definition →</a>

      <h4>Inputs</h4>
      {phase.inputFields.length === 0 && <p>(no inputs)</p>}
      {phase.inputFields.map((f) => (
        <div key={f.name} style={{ marginBottom: 8 }}>
          <label>
            {f.name} ({f.type}){f.required ? " *" : ""}
            {f.description ? <span style={{ color: "#666" }}> — {f.description}</span> : null}
          </label>
        </div>
      ))}
      {needsWs && (
        <p style={{ fontSize: 11, color: "#888" }}>
          Workspace tool selected — a <code>workspaceId</code> input must be wired.
        </p>
      )}

      <h4>Provider</h4>
      <select
        value={config.provider ?? ""}
        onChange={(e) =>
          props.onChangeConfig({
            ...config,
            provider: (e.target.value || undefined) as ProviderId | undefined,
          })
        }
      >
        <option value="">(default{phase.defaultProvider ? `: ${phase.defaultProvider}` : ""})</option>
        <option value="claude">Claude</option>
        <option value="gemini">Gemini</option>
        <option value="codex">Codex</option>
        <option value="opencode">OpenCode</option>
      </select>

      <h4>Tools</h4>
      <p style={{ fontSize: 12 }}>
        {config.tools === undefined
          ? <>Defaults from definition: <code>{phase.defaultTools.join(", ") || "(none)"}</code></>
          : <>Override: <code>{(config.tools).join(", ") || "(none)"}</code></>
        }
      </p>
      {!overrideOpen && (
        <button type="button" onClick={() => setOverrideOpen(true)}>
          {config.tools === undefined ? "Override…" : "Edit override…"}
        </button>
      )}
      {overrideOpen && (
        <div style={{ marginTop: 8 }}>
          <ToolsPicker
            value={effectiveTools}
            onChange={(next) => props.onChangeConfig({ ...config, tools: next })}
            unsupportedTools={unsupported}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                const { tools: _t, ...rest } = config;
                props.onChangeConfig(rest);
                setOverrideOpen(false);
              }}
            >
              Use definition default
            </button>
            <button type="button" onClick={() => setOverrideOpen(false)}>Done</button>
          </div>
        </div>
      )}
      {unsupported.size > 0 && effectiveProvider && (
        <p style={{ color: "#c00", fontSize: 12 }}>
          Provider <code>{effectiveProvider}</code> does not support:{" "}
          <code>{Array.from(unsupported).join(", ")}</code>. Drop the tool or switch provider.
        </p>
      )}

      <h4>Output preview</h4>
      <pre style={{ background: "#f5f5f5", padding: 8, fontSize: 12 }}>
        {JSON.stringify(
          phase.outputMode === "structured"
            ? phase.outputSchema
            : phase.outputMode === "text"
              ? { result: "string" }
              : {},
          null,
          2,
        )}
      </pre>
    </div>
  );
}
```

- [ ] **Step 15.2: Verify the web package depends on `@journeyman/coding-cli`**

In `packages/web/package.json`, check the `dependencies` block for an entry like `"@journeyman/coding-cli": "*"`. If absent, add it:

```json
"@journeyman/coding-cli": "*",
```

Then run `npm install` from the repo root so the workspace symlink is set up:

```bash
npm install
```

Expected: install completes without errors.

---

## Task 16: Final typecheck

- [ ] **Step 16.1: Run repo-wide typecheck**

Run from the repo root:

```bash
npm run typecheck
```

Expected: 0 errors. Common issues to watch for:

- A leftover reference to `needsWorkspace` somewhere else in the tree — if `tsc` flags it, search and update:

  ```bash
  grep -rn "needsWorkspace\|needs_workspace" packages/ --include='*.ts' --include='*.tsx' --include='*.sql'
  ```

  Every remaining hit must be either (a) the new `014_*.sql` migration, or (b) deleted.

- An export missing from `@journeyman/core` — re-check Task 1.2.
- A `RunCustomPromptOptions.allowedTools` reference elsewhere — search:

  ```bash
  grep -rn "allowedTools" packages/ --include='*.ts' --include='*.tsx'
  ```

  Hits inside `coding-cli/providers/claude/operations/run-custom-prompt.ts` are expected (the field is still passed to `query()` of the Claude SDK as a native option). Hits anywhere else need updating.

Fix any errors and rerun until green.

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to at least one task — canonical vocabulary (T1), `RunCustomPromptOptions` change (T2), data-model change (T3, T4, T5), validation (T6), catalog mapper (T7), runtime handler (T8), per-provider mapping (T9, T10, T11), definition editor (T12), list page (T13), flow-editor catalog (T14), flow-editor node drawer with provider × tool validation (T15).
- **Out of scope (not implemented in this plan):** the parent spec's "schema-break detection" surfaces (top-level banner, run-button gating). Those are part of the existing custom-phases design and out of scope for this tools-only plan; provider × tool errors render as a node-local message in T15.
- **Constraints honored:** no commits in any task; no unit tests; final typecheck in T16.
