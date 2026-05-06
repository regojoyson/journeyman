## Custom AI Phases — Tool Configuration

**Date:** 2026-05-06
**Status:** Spec
**Owner:** Samuel Rego
**Builds on:** [2026-05-05 Custom AI Phases](2026-05-05-custom-ai-phases-design.md)

## Summary

Let custom-phase authors pick which built-in agent tools (bash, read-file, write-file, edit-file, search, web-fetch, web-search) the phase's prompt may use, and let flow authors override that selection per node. Tool names are a canonical Journeyman vocabulary; each coding-cli provider owns a mapping table to its native tool names. The redundant `needs_workspace` flag is removed and derived from the tool selection.

## Goals

- Phase authors declare a phase's tool capabilities as part of its definition.
- Flow authors can override tools per node (mirrors how provider, MCPs, and skills work).
- Tool names are provider-agnostic; phases stay portable across Claude / Gemini / Codex / OpenCode.
- Workspace requirement is derived from tool selection — one source of truth.
- Provider × tool incompatibilities surface in the flow editor before run time.

## Non-Goals

- Custom or user-supplied tools — the canonical list is closed in v1.
- Tool-level argument constraints (e.g. "bash, but only `git` commands") — out of scope.
- Tool-set presets ("read-only", "full shell") — YAGNI; revisit if usage shows demand.
- Per-tool permissioning at the org level — out of scope for v1.

## Decisions Recap

| Area | Decision |
|---|---|
| Configuration scope | Definition-level default + per-node override |
| Tool naming | Canonical Journeyman names with per-provider mapping |
| `needs_workspace` | Removed; derived from tool selection |
| Canonical v1 list | 7 tools: `bash`, `read-file`, `write-file`, `edit-file`, `search` (grep + glob bundled), `web-fetch`, `web-search` |
| UI granularity | Individual checkboxes; no presets |
| Provider compatibility | Block at flow-edit time (red marker on node, save allowed, run blocked) |

## Canonical Tool Vocabulary

Defined in `@journeyman/core` (`packages/core/src/types/coding-tools.types.ts`):

```ts
export const CANONICAL_TOOLS = [
  "bash",
  "read-file",
  "write-file",
  "edit-file",
  "search",
  "web-fetch",
  "web-search",
] as const;
export type CanonicalTool = typeof CANONICAL_TOOLS[number];

export const WORKSPACE_TOOLS: CanonicalTool[] = [
  "bash", "read-file", "write-file", "edit-file", "search",
];

export function toolsRequireWorkspace(tools: CanonicalTool[]): boolean {
  return tools.some(t => WORKSPACE_TOOLS.includes(t));
}
```

| Canonical name | Description | Workspace? |
|---|---|---|
| `bash` | Run shell commands | yes |
| `read-file` | Read files in workspace | yes |
| `write-file` | Create/overwrite files | yes |
| `edit-file` | Patch existing files | yes |
| `search` | Find files by path or content (grep + glob) | yes |
| `web-fetch` | Fetch a URL | no |
| `web-search` | Search the web | no |

## Per-Provider Mapping

Each provider package owns a mapping from canonical names to its native tool name(s). `null` marks a tool as unsupported by that provider; the editor uses this to drive compatibility checks.

```ts
// packages/coding-cli/src/providers/claude/tool-mapping.ts
export const CLAUDE_TOOL_MAP: Record<CanonicalTool, string[] | null> = {
  "bash":       ["Bash"],
  "read-file":  ["Read"],
  "write-file": ["Write"],
  "edit-file":  ["Edit"],
  "search":     ["Grep", "Glob"],
  "web-fetch":  ["WebFetch"],
  "web-search": ["WebSearch"],
};
```

Gemini, Codex, and OpenCode ship parallel maps in their own provider packages. Tools without a confirmed equivalent on a given provider use `null` until the adapter is implemented.

A provider-agnostic helper used by the flow editor and orchestrator:

```ts
export function unsupportedTools(
  provider: ProviderId,
  tools: CanonicalTool[],
): CanonicalTool[];
```

This avoids `core` importing provider packages — the helper is wired at server bootstrap from the provider registry.

## Data Model

Two changes to `custom_ai_phases`:

```sql
ALTER TABLE custom_ai_phases
  ADD COLUMN default_tools jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE custom_ai_phases
   SET default_tools = '["bash"]'::jsonb
 WHERE needs_workspace = true;

ALTER TABLE custom_ai_phases
  DROP COLUMN needs_workspace;
```

`default_tools` holds an array of canonical tool names. New phases default to `[]` (pure-prompt phase — author opts in to capabilities explicitly).

Server-side validation on `POST`/`PATCH`:
- Every entry in `default_tools` is in `CANONICAL_TOOLS`.
- No duplicates.

## Flow Node Config

The `custom-ai` node config gains an optional `tools` field:

```ts
{
  customPhaseId: string;
  provider: "claude" | "gemini" | "codex" | "opencode";
  mcpInstanceIds?: string[];
  skillIds?: string[];
  tools?: CanonicalTool[];   // override; falls back to definition.default_tools
  // ... input wiring
}
```

The effective tool set at run time is `node.tools ?? definition.default_tools`. Saved flows that predate this change have no `tools` field and continue to work via the fallback.

## ICodingCLI Update

`runCustomPrompt` previously accepted `allowedTools?: string[]`. We replace it with the canonical type:

```ts
runCustomPrompt(opts: {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: JSONSchema;
  cwd?: string;
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkill[];
  tools?: CanonicalTool[];
}): Promise<{ result?: string; structured?: unknown }>
```

`cwd` is supplied by the caller (the handler) only when the resolved tool list intersects `WORKSPACE_TOOLS`.

### Claude implementation

```ts
const nativeTools = (opts.tools ?? []).flatMap(t => CLAUDE_TOOL_MAP[t] ?? []);
const queryOptions: Options = {
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  settingSources: [],
  ...(nativeTools.length ? { tools: nativeTools, allowedTools: nativeTools } : {}),
  ...(opts.cwd ? { cwd: opts.cwd } : {}),
  ...(opts.outputMode === "structured"
      ? { outputFormat: { type: "json_schema", schema: opts.outputSchema! } }
      : {}),
};
```

Pure-prompt phases (no tools) omit `tools` / `allowedTools` / `cwd` entirely, preserving the minimal-config pattern used by `analyze` / `plan` / `implement`.

### Other providers

Gemini, Codex, and OpenCode implement `runCustomPrompt` against their own SDKs using their own tool maps. Until each provider's adapter lands, unsupported tools surface as editor errors via the per-provider `null` entries.

## Runtime Handler

`custom-ai-phase-handler.ts` — step 7 of the existing flow is replaced by tool resolution and workspace derivation:

```
7. effective = node.tools ?? definition.default_tools
   if toolsRequireWorkspace(effective):
     require workspaceId input (throw if absent)
     cwd = resolveWorkspaceCwd(workspaceId)
   else:
     cwd = undefined
8. unsupported = unsupportedTools(provider, effective)
   if unsupported.length > 0:
     throw `Provider '${provider}' does not support tool '${unsupported[0]}'`
9. provider.runCustomPrompt({ ..., cwd, tools: effective })
```

Step 8 is a backstop. In the normal authoring flow, the editor (below) prevents this state from reaching runtime.

## Flow Editor UX

### Definition editor (Tools pane)

A new **Tools** pane sits between *Output* and *Defaults* on `/my/custom-phases` and `/admin/custom-phases`:

```
Tools
─────
☐ bash         (run shell commands)         [workspace]
☐ read-file    (read files in workspace)    [workspace]
☐ write-file   (create/overwrite files)     [workspace]
☐ edit-file    (patch existing files)       [workspace]
☐ search       (grep + glob)                [workspace]
☐ web-fetch    (fetch a URL)
☐ web-search   (search the web)

ⓘ Selecting any [workspace] tool requires this phase
   to be wired with a workspaceId input.
```

When the author ticks any workspace tool, the **Inputs** pane auto-shows a required `workspaceId` field (read-only row, can't be removed while a workspace tool is selected). Unticking the last workspace tool hides the auto-row again, unless the author has already added a manual `workspaceId` input.

### Node config drawer (Tools section)

A **Tools** section appears below *Provider* in the `custom-ai` node drawer:

```
Tools
─────
Defaults from definition: bash, read-file, search
[ Override... ]
```

Expanding **Override** reveals the same checkbox list, pre-checked with the definition defaults. Saving the override stores `node.tools` on the flow node. Clearing all checks and clicking "Use definition default" restores fallback behaviour (`node.tools` removed).

### Provider × tool compatibility

The editor maintains a live `(provider, tools)` validation. For every selected tool, if the provider's map entry is `null`:

| Surface | Treatment |
|---|---|
| The tool's checkbox row | red icon + tooltip "Not supported by Codex" |
| The node | red border, error count in the badge |
| The flow toolbar | "N nodes need attention" banner |
| Run button | disabled while errors exist |
| Save | allowed (consistent with existing schema-break handling in the parent spec) |

Switching the **Provider** dropdown re-runs the check. The same severity model is used as the parent spec's schema-break detection (errors block run, warnings do not).

## Validation & Safety

- **Server-side, on phase save:** `default_tools` ⊆ `CANONICAL_TOOLS`; no duplicates.
- **Server-side, on flow save:** for every `custom-ai` node, the effective tool set is checked against the chosen provider's map. Saving is allowed even with errors (matches schema-break handling); running is blocked.
- **Run-time, in the handler:** workspace presence and provider compatibility are re-checked as backstops.
- **Output:** unchanged — JSON Schema validation handled by the provider SDK as today.

## Migration & Rollout

1. New SQL migration adds `default_tools`, backfills `["bash"]` for `needs_workspace=true`, drops `needs_workspace`.
2. `@journeyman/core` exports the canonical vocabulary and helpers.
3. Each provider package adds its tool-map module and updates `runCustomPrompt`.
4. `@journeyman/custom-phases` validates `default_tools` on write.
5. Orchestrator handler swaps `needs_workspace` logic for tool-derived workspace logic and adds the unsupported-tool backstop.
6. Flow editor adds the Tools pane (definition editor) and Tools section (node drawer), plus provider × tool validation.

No feature flag. The change is additive at the data layer and the flow node level; existing phases and saved flows retain behaviour through the migration and the `node.tools ?? default_tools` fallback.

## Open Questions

1. **Tool descriptions / docs** — short blurbs in the UI are static for v1. If providers diverge on capability semantics (e.g. `web-fetch` rate limits), surface that later via a per-provider footnote.
2. **OpenCode tool inventory** — the OpenCode adapter is not yet implemented; its map will start mostly `null` and fill in as the provider lands. No blocker for shipping this design against Claude.
3. **Future presets** — defer until usage data shows authors repeatedly picking the same combinations.
