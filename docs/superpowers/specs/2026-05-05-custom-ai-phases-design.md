# Custom AI Phases — Design

**Date:** 2026-05-05
**Status:** Spec
**Owner:** Samuel Rego

## Summary

Let users define their own AI phases. A custom phase is a saved AI prompt with typed inputs, an optional structured output, an optional workspace toggle, and attachable MCPs/skills. Flow authors drop the phase into a flow, choose a coding-cli provider per node, and wire its inputs/outputs like any built-in phase.

## Goals

- Users can create reusable AI phases without code changes or redeploys.
- Custom phases participate in flows on equal footing with built-in phases (catalog, wiring, validation, run).
- Per-user and per-org scopes, mirroring the existing skills/MCP-instance model.
- Live edits propagate to existing flows; the flow editor flags schema-incompatible breakage before a run.

## Non-Goals

- Composition / sub-flows. A custom phase is a single AI step, not a saved mini-flow.
- User-supplied executable code (JS/shell). The phase body is a prompt only.
- Marketplace / cross-org sharing. Distribution is limited to the owning user or org.
- Automatic prompt versioning or audit history beyond `updated_at`.

## Decisions Recap

| Area | Decision |
|---|---|
| Phase body | LLM prompt run on a coding-cli provider |
| Output | Per-phase: none / single text / user-defined structured (JSON Schema) |
| Scope | Per-user **and** per-org (mirrors skills / MCP instances) |
| Workspace | Per-phase toggle (`needs_workspace`) |
| MCPs / skills | Author defaults; flow author can override per node (mirrors `analyze`/`plan`/`implement`) |
| Provider | Flow author picks per node (Claude / Gemini / Codex) |
| Inputs | Named typed fields, wireable like existing phases |
| Versioning | Live updates; flow editor diffs and surfaces schema-break errors |
| Management | Dedicated pages (`/my/custom-phases`, `/admin/custom-phases`) plus a Custom category in the flow editor catalog |

## Architecture

```
DB: custom_ai_phases ──► @journeyman/custom-phases ──► REST routes (user + org)
                                                       │
                                                       ├─► Flow editor catalog
                                                       │   (merges static + custom)
                                                       │
                                                       └─► Orchestrator handler
                                                           loads definition,
                                                           renders prompt,
                                                           calls ICodingCLI.runCustomPrompt
```

Definitions are pure data. The orchestrator has **one** generic handler that interprets any custom-phase definition at run time. No code generation, no compiled artifacts. Existing AI-phase plumbing (workspace lifecycle, MCP resolver, skill installer) is reused without modification.

## Data Model

New table:

```
custom_ai_phases
─────────────────
id                  uuid pk
scope               enum('user','org')
owner_id            uuid              -- user_id or org_id depending on scope
name                text              -- shown in catalog
description         text
input_fields        jsonb             -- [{ name, type, required, description, default? }]
output_mode         enum('none','text','structured')
output_schema       jsonb             -- only when output_mode='structured'; JSON Schema
prompt_template     text              -- mustache-style {{inputName}} substitution
needs_workspace     boolean           -- requires a `workspaceId` input + Bash tool
default_provider    text null         -- 'claude' | 'gemini' | 'codex' | null
default_mcp_ids     jsonb             -- string[]
default_skill_ids   jsonb             -- string[]
created_at          timestamptz
updated_at          timestamptz
created_by          uuid
```

Indexes:
- `(scope, owner_id)` for catalog list
- unique `(scope, owner_id, name)` to prevent dupes within a scope

Field types for `input_fields[].type`:

| Type | Wireable from |
|---|---|
| `string` | upstream string output, static value |
| `number` | upstream number output, static value |
| `boolean` | upstream boolean output, static value |
| `string[]` | upstream array-of-string output, static list |
| `workspaceId` | upstream workspace output (existing structural ref) |
| `repoRef` | upstream repo output (existing structural ref) |
| `issueRef` | upstream issue output (existing structural ref) |

Structured output is authored in a friendly field-list editor (name, type, required, description, nested objects/arrays) and serialised to JSON Schema for storage and SDK use.

## Package Layout

A new package `packages/custom-phases` (`@journeyman/custom-phases`):

```
packages/custom-phases/src/
├── db.ts                 -- table CRUD
├── routes/
│   ├── user-custom-phases.ts
│   └── org-custom-phases.ts
├── catalog.ts            -- buildPhaseCatalog({ userId, orgIds }) merger
├── prompt-renderer.ts    -- {{name}} substitution + JSON.stringify for objects
├── schema-diff.ts        -- diff old vs new definition (used by flow editor)
└── index.ts
```

A new migration `packages/migrations/src/sql/012_custom_ai_phases.sql` creates the table.

## API

Mirrors the existing skills routes.

```
GET    /api/custom-phases               -- current user's phases
POST   /api/custom-phases
GET    /api/custom-phases/:id
PATCH  /api/custom-phases/:id
DELETE /api/custom-phases/:id

GET    /api/orgs/:orgId/custom-phases   -- org-scoped (members read, admins write)
POST   /api/orgs/:orgId/custom-phases
PATCH  /api/orgs/:orgId/custom-phases/:id
DELETE /api/orgs/:orgId/custom-phases/:id

GET    /api/custom-phases/visible       -- combined list (user + their orgs);
                                           used by flow editor catalog
```

Validation on `POST`/`PATCH`:
- `name` non-empty, unique within scope
- `input_fields[].name` unique within the field list and a valid identifier
- `prompt_template` references only declared input names
- `output_schema` is valid JSON Schema when `output_mode='structured'`
- Required fields cannot have a `default`

## Catalog Integration

`@journeyman/phases/catalog` today exports a static array. We add a runtime helper:

```ts
buildPhaseCatalog({ userId, orgIds }): Promise<PhaseMeta[]>
```

It returns the static catalog plus one entry per visible custom phase. Each custom entry carries:
- `phaseType: "custom-ai"`
- `customPhaseId: <uuid>`
- `category: "Custom"`
- a `scopeBadge: "user" | "org"` for the UI
- `inputFields` and `outputSchema` derived from the stored definition

The flow editor calls this on load; the api-server uses it for flow validation.

## Flow Node Config

A flow node of `phaseType: "custom-ai"` carries:

```ts
{
  customPhaseId: string;
  provider: "claude" | "gemini" | "codex";   // chosen by flow author
  mcpInstanceIds?: string[];                  // overrides definition defaults
  skillIds?: string[];                        // overrides definition defaults
  // standard input-field wiring used by every phase node
}
```

Defaults at drop time come from the definition (`default_provider`, `default_mcp_ids`, `default_skill_ids`). The flow author can override any of them per node.

## Runtime Handler

`packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts`:

```
1. Read node config: customPhaseId, provider, mcpInstanceIds, skillIds.
2. Load the definition from custom_ai_phases (cached per-run by id).
3. Resolve mcpInstanceIds → ResolvedMcpInstance[] (existing resolver).
4. Resolve skillIds → installed skills (existing installer).
5. Resolve input values from node inputs (same path as analyze/plan/implement).
6. Render prompt: substitute {{name}} tokens with input values.
   - objects/arrays → JSON.stringify(value, null, 2)
   - missing required input → throw before calling provider
7. If needs_workspace: ensure a workspaceId input is present; pass cwd to provider.
8. Call provider.runCustomPrompt({
     prompt, outputMode, outputSchema, cwd?, mcps, skills, allowedTools
   }).
9. Map result by outputMode:
     none       → {}
     text       → { result: string }
     structured → structured_output object validated against schema
10. Return to orchestrator.
```

## ICodingCLI Extension

A new method on `ICodingCLI` (in `@journeyman/core`):

```ts
runCustomPrompt(opts: {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: JSONSchema;
  cwd?: string;                       // present iff needs_workspace
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkill[];
  allowedTools?: string[];
}): Promise<{ result?: string; structured?: unknown }>
```

`ClaudeProvider.runCustomPrompt` is implemented using `query()` from the Claude Agent SDK with the same minimal config used by `analyze`/`plan`/`implement` (`settingSources: []`, `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`):

- `cwd` is set only when present.
- `tools` / `allowedTools` = `["Bash"]` when `cwd` is present; omitted entirely in pure-prompt mode.
- `outputFormat: { type: "json_schema", schema: outputSchema }` when `outputMode === "structured"`; omitted otherwise.

`GeminiProvider` and `CodexProvider` ship as stubs throwing `"<Provider>.runCustomPrompt not implemented"`, consistent with the rest of the repo.

## Flow Editor UX

### Catalog panel

A new **Custom** category appears alongside AI / Repos / Git / Issues / Notifications. Each visible custom phase shows its name, description, and a `user` or `org` badge. Dragging a phase onto the canvas creates a `custom-ai` node prefilled with the definition's defaults.

### Node config drawer

Selecting a custom-ai node opens a drawer with:

- **Header:** name + "Edit definition →" link (opens the management page in a new tab).
- **Inputs:** one row per `input_fields` entry, using the same wiring control existing phases use (static value, or upstream-output picker filtered by compatible type).
- **Provider:** dropdown (Claude / Gemini / Codex), default = `default_provider`.
- **MCPs / Skills:** same multi-pickers used by `analyze`/`plan`/`implement`, defaulted from the definition.
- **Output preview** (read-only): shows the field tree available to downstream phases.

### Schema-break detection

On flow editor load, for every `custom-ai` node the editor fetches the current definition and diffs it against the flow's saved wiring.

| Diff | Severity | UI |
|---|---|---|
| Wired input renamed / removed | error | red marker on node + on the input row; blocks run |
| Input type changed incompatibly | error | red marker, "type mismatch" on the row |
| Optional input added | none | silent |
| Required input added | error | red marker, "required input not set" |
| Wired output field renamed / removed | error | red edge marker on every dependent edge |
| Output field type changed | warning | amber marker on dependent edges |
| Prompt or non-schema field changed | none | silent |

Errors surface on the node and as a top-level banner ("2 nodes need attention"). Saving is allowed; **running** is blocked while errors exist. Warnings do not block runs.

### Management pages

- `/my/custom-phases` — list/create/edit/delete user-scoped phases. Mirrors `MySkillsPage`.
- `/admin/custom-phases` — org-scoped, admin-gated. Mirrors `AdminSkillsPage`.

The editor has these panes:

| Pane | Contents |
|---|---|
| Definition | name, description, scope (user / org) |
| Inputs | typed-field editor (name, type, required, description, default) |
| Output | mode toggle (none / text / structured); schema editor when structured |
| Prompt | textarea with autocomplete for `{{inputName}}`; `needs_workspace` toggle |
| Defaults | provider, MCP instances, skills |

## Validation & Safety

- **Server-side schema validation** on `POST`/`PATCH` (see API).
- **Run-time input validation** in the handler before the provider call (required fields present, types match declared field types).
- **Output validation**: the SDK's `json_schema` output format already enforces structured output; we additionally guard against the SDK returning a non-success result by surfacing the error to the run timeline.
- **Workspace guard**: if `needs_workspace=true` and no `workspaceId` is wired, the flow editor flags it as an error; if it slips through, the handler throws with a clear message.

## Telemetry & Logging

- The handler logs the resolved `customPhaseId` and `customPhaseName` at run start.
- All SDK messages are routed through the existing `sdk-logger` (`logSdkMessage`).
- Metrics: per-phase invocation count and duration are tagged with `customPhaseId` so org admins can see usage of org-scoped phases.

## Migration & Rollout

- Single SQL migration adding `custom_ai_phases`.
- New package `@journeyman/custom-phases` added to the workspaces.
- New phase handler added to the orchestrator phase registry.
- Flow editor catalog gains the Custom category and node-drawer support.
- New management pages added behind the existing nav.
- No changes to existing flows or built-in phases.

## Open Questions

1. **Prompt templating beyond `{{name}}`** — do we need conditionals or loops (`{{#if}}`, `{{#each}}`)? Initial version is plain substitution; revisit if users ask.
2. **Cloning** — should `/my/custom-phases` allow "Clone to org" / "Clone from org"? Leave for a follow-up.
3. **Org admin permissions** — assume existing org-admin role gates writes; confirm against current permission model during planning.
