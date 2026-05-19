# Phase Catalog & Adapter Design

Date: 2026-04-28
Status: Draft (awaiting review)

## Goal

Today the flow-editor knows about exactly one phase — `analyze` — declared as a thin `PhaseCatalogEntry` (label + color + icon). Config is a free-form JSON textarea, no per-phase form, no per-phase canvas display, no executor binding.

This design introduces an adapter-style **phase definition** that lets each phase own everything specific to it (config schema, custom form widgets, canvas summary, runtime status badge, executor binding, common-tab visibility) while sharing a small set of cross-phase concerns. It also ships a starter catalog of 14 phases spanning the four provider categories: AI (`coding-cli`), Repos (`coding-cli` git ops), Git (`git-provider`), Tickets (`ticket-provider`), Notifications (`notification-provider`).

## Non-Goals

- No runtime engine. The executor binding is captured but not dispatched in this round.
- No unit tests in this round (per user instruction).
- No data migration. Existing saved flows with `phaseType: "analyze"` keep working unchanged.
- No 3rd-party plugin loading. The catalog is built-in.

## Architecture

```
packages/
├── core/                    ← unchanged except FlowNode.executorConfig added
├── flow-editor/             ← gains PhaseDefinition type + ExecutorBlock + SchemaForm
└── phases/                  ← NEW — depends on flow-editor (types) + core (interfaces)
    └── src/
        ├── index.ts                    exports builtInPhases + types
        ├── registry.ts                 buildPhaseRegistry(defs): Map<phaseType, def>
        ├── ai/
        │   ├── analyze.tsx
        │   ├── plan.tsx
        │   └── implement.tsx
        ├── repos/
        │   ├── scan-repos.tsx
        │   ├── checkout-repo.tsx
        │   ├── commit-push.tsx
        │   ├── cleanup-repos.tsx
        │   └── create-workspace.tsx
        ├── git/
        │   ├── get-repo.tsx
        │   ├── create-pr.tsx
        │   └── list-prs.tsx
        ├── tickets/
        │   ├── create-ticket.tsx
        │   └── update-ticket.tsx
        └── notifications/
            └── send-slack-message.tsx
```

The web app composes its `<FlowEditor />` props from `builtInPhases` exported by `@journeyman/phases`. `builtInPhaseCatalog.ts` in the web package is deleted.

## The PhaseDefinition Adapter

Lives in `packages/flow-editor/src/phase-definition.ts`. The shape:

```ts
import type { ZodTypeAny } from "zod";
import type { ComponentType } from "react";
import type { McpCatalog } from "./types.ts";

export type TabVisibility = "shown" | "hidden" | "required";

export type ExecutorKind =
  | "coding-cli"
  | "git-provider"
  | "ticket-provider"
  | "notification"
  | "control";

export interface FieldMeta {
  label: string;
  help?: string;
  widget?: "text" | "textarea" | "number" | "select" | "checkbox" | "secret" | "code";
  options?: { value: string; label: string }[];   // for "select"
}

export interface PhaseRunState {
  status: "idle" | "running" | "succeeded" | "failed";
  message?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface PhaseFormProps<TConfig> {
  config: TConfig;
  onChange: (next: TConfig) => void;
  readOnly?: boolean;
  catalogs: { mcp?: McpCatalog };
}

export interface PhaseDefinition<TConfig = unknown> {
  // identity & presentation (superset of the legacy PhaseCatalogEntry)
  phaseType: string;
  label: string;
  category: string;            // "AI" | "Repos" | "Git" | "Tickets" | "Notifications"
  description?: string;
  color: string;
  icon: string;

  // config
  defaultConfig: TConfig;
  configSchema?: ZodTypeAny;
  configFields?: Record<string, FieldMeta>;
  ConfigForm?: ComponentType<PhaseFormProps<TConfig>>;

  // common-tab visibility
  tabs: {
    io: TabVisibility;
    credentials: TabVisibility;
    mcp: TabVisibility;
    retry: TabVisibility;
  };

  // canvas display
  summary?: (config: TConfig) => string;
  StatusBadge?: ComponentType<{ state: PhaseRunState }>;

  // executor binding (no runtime built; captured intent only)
  executor: {
    kind: ExecutorKind;
    method: string;
  };
}
```

### Rendering rules (Config tab)

In order:

1. Generic fields — phase-type select + display name (always rendered).
2. **Executor block** — auto-rendered from `executorCommonConfig[definition.executor.kind]` (see below). For coding-cli phases this surfaces the Claude/Gemini/Codex selector.
3. `<definition.ConfigForm />` if present.
4. Schema-driven form — driven by `definition.configSchema` + `definition.configFields` if both present.

A phase can use **just schema**, **just custom form**, or **both** (custom form for tricky widgets, schema for the rest, rendered in that order).

## Executor-Kind Common Config

A small static lookup, defined once in `flow-editor`:

```ts
// packages/flow-editor/src/executor-common-config.ts
export const executorCommonConfig = {
  "coding-cli":      { provider: ["claude", "gemini", "codex"] as const },
  "git-provider":    { provider: ["github", "gitlab"] as const },
  "ticket-provider": { provider: ["jira", "linear", "monday"] as const },
  "notification":    { provider: ["slack"] as const },
  "control":         {},
} as const;
```

Stored on the node as a separate field (so phase-specific `config` and kind-shared `executorConfig` never collide):

```ts
// packages/core/src/types/flow.types.ts (extension to FlowNode)
interface FlowNode {
  // …existing fields
  config?: unknown;
  executorConfig?: { provider?: string };
}
```

The editor renders an `<ExecutorBlock />` that reads the lookup for `definition.executor.kind` and emits a labeled `<select>` per key (today: just `provider`). For `kind === "control"` the block is suppressed.

## Common Tab Visibility

`PropertiesPanel` filters its tab strip by `definition.tabs[name]`:

- `"shown"` — tab is mounted normally.
- `"hidden"` — tab is removed from the strip.
- `"required"` — tab is mounted; a small "•" indicator is shown beside its label when its underlying data on the node is empty.

Default visibility per category for built-in phases:

| Category | io | credentials | mcp | retry |
|---|---|---|---|---|
| AI | shown | required | shown | shown |
| Repos | shown | hidden | hidden | shown |
| Git | shown | required | hidden | shown |
| Tickets | shown | required | hidden | shown |
| Notifications | hidden | required | hidden | shown |

## Canvas Display

`PhaseNode` ([PhaseNode.tsx](../../../packages/flow-editor/src/canvas/nodes/PhaseNode.tsx)) gains:

- **Subtitle** — `definition.summary?.(node.config) ?? definition.label`. Design-time string derived from the phase's current config (e.g. `send-slack-message` shows `#deploys`, `analyze` shows `PROJ-123`).
- **Status corner** — only rendered when `phaseRunStates[node.id]` is provided. If the definition supplies a `StatusBadge`, it's used; otherwise a small default colored dot (idle gray / running blue spinning / succeeded green / failed red) is rendered as fallback so every phase gets *some* runtime indicator.

`FlowEditorProps` gains an optional `phaseRunStates?: Record<nodeId, PhaseRunState>`. When undefined, no status corner is rendered at all (clean design-time view).

## The 14-Phase Catalog

| # | phaseType | Category | Executor (kind.method) | Default config (sketch) | ConfigForm? |
|---|---|---|---|---|---|
| 1 | `analyze` | AI | `coding-cli.analyze` | `{ ticketKey, repoPath, instructions? }` | No |
| 2 | `plan` | AI | `coding-cli.plan` | `{ ticketKey, repoPath, analysisRef? }` | No |
| 3 | `implement` | AI | `coding-cli.implement` | `{ planRef, repoPath }` | No |
| 4 | `scan-repos` | Repos | `coding-cli.scanRepos` | `{ workspaceDir, pattern }` | No |
| 5 | `checkout-repo` | Repos | `coding-cli.checkoutRepo` | `{ url, branch?, targetDir }` | No |
| 6 | `commit-push` | Repos | `coding-cli.commitPushRepos` | `{ repoPath, message, branch? }` | No |
| 7 | `cleanup-repos` | Repos | `coding-cli.cleanupRepos` | `{ workspaceDir, mode: "soft"\|"hard" }` | No |
| 8 | `create-workspace` | Repos | `coding-cli.createWorkspace` | `{ name, baseDir }` | No |
| 9 | `get-repo` | Git | `git-provider.getRepo` | `{ owner, repo }` | No |
| 10 | `create-pr` | Git | `git-provider.createPR` | `{ owner, repo, title, body, head, base }` | No |
| 11 | `list-prs` | Git | `git-provider.listPRs` | `{ owner, repo, state }` | No |
| 12 | `create-ticket` | Tickets | `ticket-provider.createTicket` | `{ project, title, description, labels[] }` | No |
| 13 | `update-ticket` | Tickets | `ticket-provider.updateTicket` | `{ ticketKey, fields }` | Yes (dynamic fields) |
| 14 | `send-slack-message` | Notifications | `notification.sendMessage` | `{ channel, message, blocks? }` | No |

Round 1 ships only `update-ticket` with a custom `ConfigForm` (its `fields` map is dynamic). Everything else uses schema + `configFields` metadata. The custom-form escape hatch is available for upgrades later (e.g. swap `analyze`'s `ticketKey` text input for a Jira autocomplete picker without touching anything else).

## Editor Integration

### `FlowEditorProps`

```ts
// packages/flow-editor/src/types.ts
export interface FlowEditorProps {
  flow: FlowGraph;
  flowName: string;
  phases: PhaseDefinition[];                       // was: phaseCatalog: PhaseCatalog
  controlCatalog?: ControlNodeCatalog;
  mcpCatalog?: McpCatalog;
  phaseRunStates?: Record<string, PhaseRunState>;  // new
  onChange: (flow: FlowGraph) => void;
  onSave?: (flow: FlowGraph) => void | Promise<void>;
  onRun?: (flow: FlowGraph) => void | Promise<void>;
  readOnly?: boolean;
  busy?: boolean;
  onRename?: (newName: string) => void;
}
```

The legacy `PhaseCatalog` / `PhaseCatalogEntry` types and the `phaseCatalog` prop are removed (no compatibility shim). The web app is the only known caller; it's updated in the same change.

### `PhaseRegistry`

A thin Map wrapper built once from the `phases` prop:

```ts
// packages/flow-editor/src/state/phase-registry.ts
export class PhaseRegistry {
  constructor(definitions: PhaseDefinition[]) { /* … */ }
  get(phaseType: string): PhaseDefinition | undefined;
  list(): PhaseDefinition[];
}
```

Provided to children via React context (`PhaseRegistryContext`), avoiding prop-drilling through Palette / Canvas / PropertiesPanel.

### `PropertiesPanel` changes

- Reads `definition = registry.get(node.phaseType)` once per render.
- Tab strip filters by `definition.tabs[name]`. `"required"` decorates the tab label with `•` when the tab's slice of node state is empty (`io.inputs`/`io.outputs`, `credentials`, `mcp`, `retry` respectively).
- `ConfigTab` body is restructured into the four-step renderer described above.
- `SchemaForm` is a new internal component (~150 LOC) that walks a Zod object schema and renders one row per field driven by `configFields[key].widget`. Fallback widget is `"text"`.

### `PhaseNode` changes

- Renders `definition.summary?.(data.config)` as the subtitle line beneath the display name; falls back to `data.catalogEntry?.label`.
- Renders status corner only when the parent passes `phaseRunStates`. Uses `definition.StatusBadge` if present; falls back to the default dot.

Definition lookup happens inside the node component via `PhaseRegistryContext`. The node's persisted `data` is unchanged — saved graphs do not carry React or any reference to the definition object.

## Web-side Changes

- New dependency: `@journeyman/web` → `@journeyman/phases`.
- `packages/web/src/catalogs/built-in-phase-catalog.ts` — deleted.
- `packages/web/src/routes/FlowEditorPage.tsx` — replace `phaseCatalog={builtInPhaseCatalog}` with `phases={builtInPhases}` (importing from `@journeyman/phases`).

## Backwards Compatibility

- Saved flows with existing nodes (`phaseType: "analyze"` only, today) continue to load. The `analyze` definition under `packages/phases/src/ai/analyze.tsx` keeps the same color/icon/label as today's entry, so the canvas looks unchanged.
- `node.config` was previously a free-form `unknown`. The new schema is *not enforced* on load — invalid/missing fields render as defaults from `definition.defaultConfig`. The first time a user saves an existing flow, missing fields are filled in from defaults and `executorConfig.provider` is initialized to the first option for the phase's executor kind.
- Removing the `phaseCatalog` prop is a breaking change to `@journeyman/flow-editor`'s public API. The only known consumer is the web app, which is updated in the same change.

## Risks & Open Questions

- **Zod as a runtime dep of `@journeyman/phases`** — adds bundle weight to the web app. Acceptable; Zod is already used elsewhere in the monorepo for SDK schemas.
- **`update-ticket` custom form** — shape of `fields` depends on the chosen ticket provider (Jira fields ≠ Linear fields). Round 1 renders a generic key/value editor; future work can specialize per provider. Marked in code as `// TODO: provider-specific field editor`.
- **`StatusBadge` API surface** — single `PhaseRunState` may be too thin (no progress %, no streamed messages). Easy to extend later as a non-breaking field addition.

## Out of Scope

- Runtime engine that consumes `executor.kind/method` and dispatches to providers.
- Validation surfacing in the canvas (red-dot on misconfigured nodes). Schema validation runs but errors are only shown inside the Config tab in round 1.
- Per-phase IO port shape declarations (today IO names are free-form strings on the node).
- Unit tests.

## Verification

After implementation:

1. `npm run typecheck` at the repo root — must pass cleanly.
2. Manual smoke: open the web flow editor, drag each of the 14 phases onto the canvas, fill in their fields, confirm tab visibility matches the table, confirm canvas subtitles update from config, confirm the executor-block dropdowns appear with correct options per kind.

No commits are made by the implementation; the user will review and commit.
