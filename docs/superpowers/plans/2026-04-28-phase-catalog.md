# Phase Catalog & Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an adapter-style `PhaseDefinition` to the flow editor, ship a 14-phase built-in catalog in a new `@journeyman/phases` package, and wire per-phase config / tab visibility / canvas summary / status badges / executor binding through the editor.

**Architecture:** New `PhaseDefinition` type in `@journeyman/flow-editor` plus a `PhaseRegistry` React context. New package `@journeyman/phases` exporting `builtInPhases: PhaseDefinition[]`. The editor's `phaseCatalog` prop is replaced by `phases`; `PropertiesPanel`, `ConfigTab`, `Palette`, `Canvas`, and `PhaseNode` all consume the registry for per-phase rendering. `FlowNode` gains an optional `executorConfig` (separate from `config`) populated by an auto-rendered `ExecutorBlock`.

**Tech Stack:** TypeScript, React 18, Zod (validation), `@xyflow/react` (canvas), npm workspaces.

**User constraints:**
- Skip unit tests in this round.
- Run `npm run typecheck` only at the very end.
- Do not commit; the user will review and commit.

---

## File Map

### New files

**`packages/flow-editor/src/`**
- `phase-definition.ts` — `PhaseDefinition`, `PhaseRunState`, `FieldMeta`, `TabVisibility`, `ExecutorKind`, `PhaseFormProps` types.
- `executor-common-config.ts` — `executorCommonConfig` lookup (provider options per kind).
- `state/phase-registry.ts` — `PhaseRegistry` class + `PhaseRegistryContext` + `usePhaseRegistry` hook.
- `properties-panel/SchemaForm.tsx` — generic schema-driven form renderer.
- `properties-panel/ExecutorBlock.tsx` — auto-rendered executor-kind common-config dropdown(s).

**`packages/phases/`** (new package)
- `package.json`, `tsconfig.json`
- `src/index.ts` — barrel exports.
- `src/registry.ts` — assembles `builtInPhases` array.
- `src/ai/{analyze,plan,implement}.tsx`
- `src/repos/{scan-repos,checkout-repo,commit-push,cleanup-repos,create-workspace}.tsx`
- `src/git/{get-repo,create-pr,list-prs}.tsx`
- `src/tickets/{create-ticket,update-ticket}.tsx`
- `src/notifications/send-slack-message.tsx`

### Modified files

- `packages/core/src/types/flow.types.ts` — add `executorConfig` to `FlowNode`.
- `packages/flow-editor/src/types.ts` — replace `PhaseCatalog/Entry`; update `FlowEditorProps`.
- `packages/flow-editor/src/index.ts` — update exports.
- `packages/flow-editor/src/FlowEditor.tsx` — provide `PhaseRegistryContext`, replace `phaseCatalog` prop.
- `packages/flow-editor/src/canvas/Canvas.tsx` — accept `phases` instead of `catalog`.
- `packages/flow-editor/src/canvas/nodes/PhaseNode.tsx` — subtitle from `summary`, status badge.
- `packages/flow-editor/src/palette/Palette.tsx` — derive presentation from `PhaseDefinition[]`.
- `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` — read definition, filter tabs by visibility.
- `packages/flow-editor/src/properties-panel/tabs-shell.tsx` — accept `visibility` prop, hide hidden tabs, decorate required.
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — new render order (executor block + custom form + schema form).
- `packages/flow-editor/package.json` — add `zod` dep.
- `packages/web/src/routes/FlowEditorPage.tsx` — pass `phases={builtInPhases}` instead of `phaseCatalog`.
- `packages/web/package.json` — add `@journeyman/phases` dep.

### Deleted files

- `packages/web/src/catalogs/built-in-phase-catalog.ts`

---

## Task 1: Add `executorConfig` to core `FlowNode`

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:23-39`

- [ ] **Step 1: Extend the `FlowNode` interface**

In `packages/core/src/types/flow.types.ts`, replace the `FlowNode` interface body to add `executorConfig`:

```ts
export interface FlowNode {
  id: string;
  type: FlowNodeType;
  /** Human-readable label shown on the canvas tile. */
  displayName?: string;
  /** Phase type ("analyze", "clone-repos", …) — required when type === "phase". */
  phaseType?: string;
  /** Free-form configuration consumed by the phase handler. */
  config?: Record<string, unknown>;
  /**
   * Common configuration shared by all phases of the same executor kind
   * (e.g. coding-cli phases all carry `{ provider: "claude" | "gemini" | "codex" }`).
   * Kept separate from `config` so phase-specific and kind-shared fields never collide.
   */
  executorConfig?: { provider?: string };
  /** Per-phase retry policy. */
  retry?: RetryPolicy;
  /** Position on canvas — opaque to engine; preserved on round-trip. */
  position?: { x: number; y: number };
  /** Only meaningful on `end` nodes — surfaced as the run's outcome label. */
  outcome?: string;
}
```

---

## Task 2: Create `phase-definition.ts` types in flow-editor

**Files:**
- Create: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 1: Add zod as a dependency of `@journeyman/flow-editor`**

In `packages/flow-editor/package.json`, add `"zod": "^3.23.8"` to `dependencies` (alongside `@journeyman/core`).

- [ ] **Step 2: Install the new dependency**

From repo root, run: `npm install`
Expected: completes without error; `node_modules/zod` is present under the flow-editor package.

- [ ] **Step 3: Create `phase-definition.ts`**

```ts
// packages/flow-editor/src/phase-definition.ts
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
  options?: { value: string; label: string }[];
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
  // identity & presentation
  phaseType: string;
  label: string;
  category: string;
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

  // executor binding (no runtime; intent only)
  executor: {
    kind: ExecutorKind;
    method: string;
  };
}
```

---

## Task 3: Create `executor-common-config.ts`

**Files:**
- Create: `packages/flow-editor/src/executor-common-config.ts`

- [ ] **Step 1: Write the lookup**

```ts
// packages/flow-editor/src/executor-common-config.ts
import type { ExecutorKind } from "./phase-definition.ts";

export interface ProviderOption { value: string; label: string }

export interface ExecutorKindCommonConfig {
  provider?: ProviderOption[];
}

export const executorCommonConfig: Record<ExecutorKind, ExecutorKindCommonConfig> = {
  "coding-cli": {
    provider: [
      { value: "claude", label: "Claude" },
      { value: "gemini", label: "Gemini" },
      { value: "codex",  label: "Codex"  },
    ],
  },
  "git-provider": {
    provider: [
      { value: "github", label: "GitHub" },
      { value: "gitlab", label: "GitLab" },
    ],
  },
  "ticket-provider": {
    provider: [
      { value: "jira",   label: "Jira"   },
      { value: "linear", label: "Linear" },
      { value: "monday", label: "Monday" },
    ],
  },
  "notification": {
    provider: [
      { value: "slack", label: "Slack" },
    ],
  },
  "control": {},
};

export function defaultProviderFor(kind: ExecutorKind): string | undefined {
  return executorCommonConfig[kind].provider?.[0]?.value;
}
```

---

## Task 4: Update `flow-editor/types.ts` — replace PhaseCatalog with PhaseDefinition

**Files:**
- Modify: `packages/flow-editor/src/types.ts`

- [ ] **Step 1: Replace the file**

Overwrite `packages/flow-editor/src/types.ts` with:

```ts
import type { FlowGraph, FlowNodeType, McpTransport } from "@journeyman/core";
import type { PhaseDefinition, PhaseRunState } from "./phase-definition.ts";

export interface ControlNodeCatalogEntry {
  nodeType: FlowNodeType;
  label: string;
  category: string;
  description?: string;
  color: string;
  icon: string;
}
export type ControlNodeCatalog = ControlNodeCatalogEntry[];

export interface McpCatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
}
export type McpCatalog = McpCatalogEntry[];

export interface FlowEditorProps {
  flow: FlowGraph;
  flowName: string;
  /** Built-in or extension phase definitions, used to power the palette, properties panel, and canvas. */
  phases: PhaseDefinition[];
  controlCatalog?: ControlNodeCatalog;
  mcpCatalog?: McpCatalog;
  /** Optional runtime status keyed by node id. When undefined, no status badge is rendered. */
  phaseRunStates?: Record<string, PhaseRunState>;
  onChange: (flow: FlowGraph) => void;
  onSave?: (flow: FlowGraph) => void | Promise<void>;
  onRun?: (flow: FlowGraph) => void | Promise<void>;
  readOnly?: boolean;
  busy?: boolean;
  onRename?: (newName: string) => void;
}
```

`PhaseCatalog` and `PhaseCatalogEntry` are intentionally removed.

---

## Task 5: Create `PhaseRegistry` and React context

**Files:**
- Create: `packages/flow-editor/src/state/phase-registry.ts`
- Create: `packages/flow-editor/src/state/phase-registry-context.tsx`

- [ ] **Step 1: Create the registry class**

```ts
// packages/flow-editor/src/state/phase-registry.ts
import type { PhaseDefinition } from "../phase-definition.ts";

export class PhaseRegistry {
  private byType: Map<string, PhaseDefinition>;
  constructor(definitions: PhaseDefinition[]) {
    this.byType = new Map(definitions.map(d => [d.phaseType, d]));
  }
  get(phaseType: string | undefined): PhaseDefinition | undefined {
    if (!phaseType) return undefined;
    return this.byType.get(phaseType);
  }
  list(): PhaseDefinition[] {
    return [...this.byType.values()];
  }
}
```

- [ ] **Step 2: Create the React context + hook**

```tsx
// packages/flow-editor/src/state/phase-registry-context.tsx
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { PhaseRegistry } from "./phase-registry.ts";
import type { PhaseDefinition } from "../phase-definition.ts";

const PhaseRegistryContext = createContext<PhaseRegistry | null>(null);

export function PhaseRegistryProvider(
  { phases, children }: { phases: PhaseDefinition[]; children: ReactNode },
) {
  const registry = useMemo(() => new PhaseRegistry(phases), [phases]);
  return (
    <PhaseRegistryContext.Provider value={registry}>
      {children}
    </PhaseRegistryContext.Provider>
  );
}

export function usePhaseRegistry(): PhaseRegistry {
  const r = useContext(PhaseRegistryContext);
  if (!r) throw new Error("usePhaseRegistry called outside PhaseRegistryProvider");
  return r;
}
```

---

## Task 6: Create `SchemaForm` component

The schema-driven form does NOT walk the Zod schema — it iterates the parallel `configFields` map and reads/writes `config[key]`. The Zod schema is used only for `safeParse` validation, surfaced as an error list below the fields.

**Files:**
- Create: `packages/flow-editor/src/properties-panel/SchemaForm.tsx`

- [ ] **Step 1: Create the file**

```tsx
// packages/flow-editor/src/properties-panel/SchemaForm.tsx
import type { ZodTypeAny } from "zod";
import type { FieldMeta } from "../phase-definition.ts";

export interface SchemaFormProps {
  config: Record<string, unknown>;
  fields: Record<string, FieldMeta>;
  schema?: ZodTypeAny;
  onChange: (next: Record<string, unknown>) => void;
  readOnly?: boolean;
}

export function SchemaForm({ config, fields, schema, onChange, readOnly }: SchemaFormProps) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });

  const errors: string[] = [];
  if (schema) {
    const parsed = schema.safeParse(config);
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        errors.push(`${i.path.join(".") || "(root)"}: ${i.message}`);
      }
    }
  }

  return (
    <div>
      {Object.entries(fields).map(([key, meta]) => (
        <div key={key} className="je-props__field">
          <label>{meta.label}</label>
          <FieldInput
            meta={meta}
            value={config[key]}
            disabled={readOnly}
            onChange={v => set(key, v)}
          />
          {meta.help && <div style={{ fontSize: 11, color: "#888" }}>{meta.help}</div>}
        </div>
      ))}
      {errors.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#ff7675" }}>
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
    </div>
  );
}

function FieldInput(
  { meta, value, disabled, onChange }: {
    meta: FieldMeta;
    value: unknown;
    disabled?: boolean;
    onChange: (v: unknown) => void;
  },
) {
  const widget = meta.widget ?? "text";
  switch (widget) {
    case "textarea":
      return (
        <textarea
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          type="number"
          value={(value as number | undefined) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "checkbox":
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
        />
      );
    case "select":
      return (
        <select
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(meta.options ?? []).map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    case "secret":
      return (
        <input
          type="password"
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      );
    case "code":
      return (
        <textarea
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          style={{ fontFamily: "monospace" }}
        />
      );
    case "text":
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ""}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      );
  }
}
```

---

## Task 7: Create `ExecutorBlock` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/ExecutorBlock.tsx`

- [ ] **Step 1: Create the file**

```tsx
// packages/flow-editor/src/properties-panel/ExecutorBlock.tsx
import type { ExecutorKind } from "../phase-definition.ts";
import { executorCommonConfig } from "../executor-common-config.ts";

export interface ExecutorBlockProps {
  kind: ExecutorKind;
  value: { provider?: string } | undefined;
  onChange: (next: { provider?: string }) => void;
  readOnly?: boolean;
}

export function ExecutorBlock({ kind, value, onChange, readOnly }: ExecutorBlockProps) {
  const cfg = executorCommonConfig[kind];
  if (!cfg.provider || cfg.provider.length === 0) return null;

  return (
    <div className="je-props__field">
      <label>Provider</label>
      <select
        value={value?.provider ?? ""}
        disabled={readOnly}
        onChange={e => onChange({ ...(value ?? {}), provider: e.target.value })}
      >
        {cfg.provider.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
```

---

## Task 8: Update `tabs-shell.tsx` for visibility

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/tabs-shell.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// packages/flow-editor/src/properties-panel/tabs-shell.tsx
import type { ReactNode } from "react";
import type { TabVisibility } from "../phase-definition.ts";

export type TabId = "config" | "mcp" | "credentials" | "retry" | "io";

export interface TabsVisibility {
  config?: TabVisibility; // always shown effectively; declared for symmetry
  io: TabVisibility;
  credentials: TabVisibility;
  mcp: TabVisibility;
  retry: TabVisibility;
}

export interface TabRequiredFlags {
  io?: boolean;
  credentials?: boolean;
  mcp?: boolean;
  retry?: boolean;
}

export interface TabShellProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  visibility: TabsVisibility;
  /** Per-tab "data is empty" flags — when a tab is `required` AND its flag is true, decorate with •. */
  requiredEmpty?: TabRequiredFlags;
  children: ReactNode;
}

const ALL_TABS: Array<{ id: TabId; label: string }> = [
  { id: "config",      label: "Config"      },
  { id: "mcp",         label: "MCP & Tools" },
  { id: "credentials", label: "Credentials" },
  { id: "retry",       label: "Retry"       },
  { id: "io",          label: "I/O"         },
];

function visibilityOf(id: TabId, v: TabsVisibility): TabVisibility {
  if (id === "config") return "shown";
  return v[id];
}

export function TabsShell({ active, onChange, visibility, requiredEmpty, children }: TabShellProps) {
  const visible = ALL_TABS.filter(t => visibilityOf(t.id, visibility) !== "hidden");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, fontSize: 11, marginBottom: 10, flexWrap: "wrap" }}>
        {visible.map(t => {
          const req = visibilityOf(t.id, visibility) === "required";
          const empty = req && t.id !== "config" && (requiredEmpty?.[t.id as Exclude<TabId, "config">] ?? false);
          return (
            <div
              key={t.id}
              onClick={() => onChange(t.id)}
              style={{
                padding: "6px 8px",
                borderBottom: t.id === active ? "2px solid #4a9eff" : "2px solid transparent",
                color: t.id === active ? "#4a9eff" : "#aaa",
                fontWeight: t.id === active ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {t.label}{empty ? " •" : ""}
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
```

---

## Task 9: Update `PropertiesPanel.tsx`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// packages/flow-editor/src/properties-panel/PropertiesPanel.tsx
import { useState } from "react";
import type { FlowGraph, FlowNode } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";
import { TabsShell, type TabId, type TabsVisibility } from "./tabs-shell.tsx";
import { ConfigTab } from "./ConfigTab.tsx";
import { McpToolsTab } from "./McpToolsTab.tsx";
import { CredentialsTab } from "./CredentialsTab.tsx";
import { RetryTab } from "./RetryTab.tsx";
import { IoTab } from "./IoTab.tsx";
import { FlowSettingsView } from "./FlowSettingsView.tsx";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";

export interface PropertiesPanelProps {
  flow: FlowGraph;
  node: FlowNode | null;
  mcpCatalog: McpCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

const DEFAULT_VISIBILITY: TabsVisibility = {
  io:          "shown",
  credentials: "shown",
  mcp:         "shown",
  retry:       "shown",
};

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { flow, node, mcpCatalog, onChange, readOnly } = props;
  const registry = usePhaseRegistry();
  const [active, setActive] = useState<TabId>("config");

  if (!node) {
    return (
      <aside className="je-editor__props">
        <div className="je-empty">Select a node to configure it.</div>
      </aside>
    );
  }

  if (node.type === "start") {
    return (
      <aside className="je-editor__props">
        <FlowSettingsView startNode={node} onChange={onChange} readOnly={readOnly} />
      </aside>
    );
  }

  const isPhase = node.type === "phase";
  const definition = isPhase ? registry.get(node.phaseType) : undefined;
  const visibility: TabsVisibility = definition
    ? { io: definition.tabs.io, credentials: definition.tabs.credentials, mcp: definition.tabs.mcp, retry: definition.tabs.retry }
    : DEFAULT_VISIBILITY;

  // "required + empty" indicators
  const requiredEmpty = {
    io: !((node as { inputs?: unknown[] }).inputs?.length || (node as { outputs?: unknown[] }).outputs?.length),
    credentials: !(node as { credentials?: unknown }).credentials,
    mcp: !((node as { mcpTools?: unknown[] }).mcpTools?.length),
    retry: !node.retry,
  };

  // If the active tab gets hidden due to definition change, fall back to config.
  const effectiveActive: TabId =
    active !== "config" && visibility[active] === "hidden" ? "config" : active;

  return (
    <aside className="je-editor__props">
      <div className="je-props__title">{node.displayName ?? node.type}</div>
      {isPhase ? (
        <TabsShell
          active={effectiveActive}
          onChange={setActive}
          visibility={visibility}
          requiredEmpty={requiredEmpty}
        >
          {effectiveActive === "config"      && <ConfigTab    node={node} onChange={onChange} readOnly={readOnly} mcpCatalog={mcpCatalog} />}
          {effectiveActive === "mcp"         && <McpToolsTab  node={node} catalog={mcpCatalog} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "credentials" && <CredentialsTab node={node} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "retry"       && <RetryTab     node={node} onChange={onChange} readOnly={readOnly} />}
          {effectiveActive === "io"          && <IoTab        flow={flow} node={node} onChange={onChange} readOnly={readOnly} />}
        </TabsShell>
      ) : (
        <div className="je-empty">
          {node.type === "end" ? "End node — set the outcome label in the Inspector (Phase 6)." : "Control nodes have no per-tab config in v0."}
        </div>
      )}
    </aside>
  );
}
```

Note: `catalog` prop is removed; `ConfigTab` now needs `mcpCatalog` for the custom-form context.

---

## Task 10: Update `ConfigTab.tsx` for the new render order

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// packages/flow-editor/src/properties-panel/ConfigTab.tsx
import type { FlowNode } from "@journeyman/core";
import type { McpCatalog } from "../types.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import { ExecutorBlock } from "./ExecutorBlock.tsx";
import { SchemaForm } from "./SchemaForm.tsx";
import { defaultProviderFor } from "../executor-common-config.ts";

export interface ConfigTabProps {
  node: FlowNode;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
  mcpCatalog?: McpCatalog;
}

export function ConfigTab({ node, onChange, readOnly, mcpCatalog }: ConfigTabProps) {
  const registry = usePhaseRegistry();
  const definition = registry.get(node.phaseType);
  const config = (node.config ?? {}) as Record<string, unknown>;
  const executorConfig = node.executorConfig ?? {};

  return (
    <div>
      <div className="je-props__field">
        <label>Phase type</label>
        <select
          value={node.phaseType ?? ""}
          disabled={readOnly}
          onChange={e => {
            const nextType = e.target.value;
            const nextDef = registry.get(nextType);
            const nextProvider = nextDef ? defaultProviderFor(nextDef.executor.kind) : undefined;
            onChange({
              ...node,
              phaseType: nextType,
              config: nextDef ? { ...(nextDef.defaultConfig as Record<string, unknown>) } : node.config,
              executorConfig: nextProvider ? { provider: nextProvider } : undefined,
            });
          }}
        >
          {registry.list().map(d => (
            <option key={d.phaseType} value={d.phaseType}>{d.label}</option>
          ))}
        </select>
      </div>

      <div className="je-props__field">
        <label>Display name</label>
        <input
          type="text"
          value={node.displayName ?? ""}
          disabled={readOnly}
          onChange={e => onChange({ ...node, displayName: e.target.value })}
        />
      </div>

      {definition && (
        <ExecutorBlock
          kind={definition.executor.kind}
          value={executorConfig}
          onChange={next => onChange({ ...node, executorConfig: next })}
          readOnly={readOnly}
        />
      )}

      {definition?.ConfigForm && (
        <definition.ConfigForm
          config={config as never}
          onChange={next => onChange({ ...node, config: next as Record<string, unknown> })}
          readOnly={readOnly}
          catalogs={{ mcp: mcpCatalog }}
        />
      )}

      {definition?.configFields && (
        <SchemaForm
          config={config}
          fields={definition.configFields}
          schema={definition.configSchema}
          onChange={next => onChange({ ...node, config: next })}
          readOnly={readOnly}
        />
      )}

      {definition?.description && (
        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>{definition.description}</div>
      )}
    </div>
  );
}
```

---

## Task 11: Update `PhaseNode.tsx` — subtitle from `summary`, status badge

**Files:**
- Modify: `packages/flow-editor/src/canvas/nodes/PhaseNode.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// packages/flow-editor/src/canvas/nodes/PhaseNode.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue, handleRed } from "../handle-styles.ts";
import { usePhaseRegistry } from "../../state/phase-registry-context.tsx";
import type { PhaseRunState } from "../../phase-definition.ts";

export interface PhaseNodeData {
  displayName: string;
  phaseType: string;
  config?: Record<string, unknown>;
  runState?: PhaseRunState;
  [key: string]: unknown;
}

const STATUS_COLORS: Record<PhaseRunState["status"], string> = {
  idle:      "#999",
  running:   "#4a9eff",
  succeeded: "#00b894",
  failed:    "#ff7675",
};

function DefaultStatusBadge({ state }: { state: PhaseRunState }) {
  return (
    <div
      title={state.message ?? state.status}
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: STATUS_COLORS[state.status],
      }}
    />
  );
}

export function PhaseNode(props: NodeProps) {
  const data = props.data as PhaseNodeData;
  const registry = usePhaseRegistry();
  const definition = registry.get(data.phaseType);
  const accent = definition?.color ?? "#6c5ce7";
  const icon = definition?.icon ?? "⚙";
  const subtitle =
    (definition?.summary && data.config && definition.summary(data.config)) ||
    definition?.label ||
    data.phaseType;
  const Badge = definition?.StatusBadge ?? DefaultStatusBadge;

  return (
    <div className="je-node je-node--phase" style={{ borderColor: accent, position: "relative" }}>
      {data.runState && <Badge state={data.runState} />}
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon" style={{ background: accent }}>{icon}</div>
        <div className="je-node__text">
          <div className="je-node__label">{data.displayName}</div>
          <div className="je-node__subtitle">{subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
      <Handle type="source" position={Position.Bottom} id="error" style={handleRed} title="Error output" />
    </div>
  );
}
```

---

## Task 12: Update `Canvas.tsx` — drop `catalog`, accept `phases` + `runStates`

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Replace the imports and `CanvasProps`**

In `packages/flow-editor/src/canvas/Canvas.tsx`, replace the import block at the top and the `CanvasProps` interface:

```ts
import type { FlowEdge, FlowEdgeType, FlowGraph, FlowNode, FlowNodeType } from "@journeyman/core";
import { nodeTypes, edgeTypes } from "./node-registry.ts";
import { newPhaseNode, newEdge } from "../state/flow-graph.ts";
import type { PhaseRunState } from "../phase-definition.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";

export interface CanvasProps {
  flow: FlowGraph;
  selectedNodeId: string | null;
  onChange: (next: FlowGraph) => void;
  onSelect: (nodeId: string | null) => void;
  readOnly?: boolean;
  phaseRunStates?: Record<string, PhaseRunState>;
}
```

- [ ] **Step 2: Replace `toReactFlowNodes`**

```ts
function toReactFlowNodes(
  flow: FlowGraph,
  selectedId: string | null,
  runStates?: Record<string, PhaseRunState>,
): Node[] {
  return flow.nodes.map(n => ({
    id: n.id,
    type: KNOWN_NODE_TYPES.has(n.type) ? n.type : "phase",
    position: n.position ?? { x: 0, y: 0 },
    data: n.type === "phase"
      ? {
          displayName: n.displayName ?? n.phaseType ?? "Phase",
          phaseType: n.phaseType ?? "",
          config: n.config ?? {},
          runState: runStates?.[n.id],
        }
      : {
          displayName: n.displayName ?? n.type,
          ...(n.config ?? {}),
        },
    selected: n.id === selectedId,
    draggable: true,
    selectable: true,
  }));
}
```

- [ ] **Step 3: Update `CanvasInner` to use the registry instead of `p.catalog`**

Inside `CanvasInner`, replace any reference to `p.catalog` with the registry. Specifically:

- Replace the two existing `useNodesState` / `useEffect` resync calls that reference `p.catalog` with versions using `p.phaseRunStates`:

```ts
const [nodes, setNodes, onNodesChangeInternal] = useNodesState<Node>(
  toReactFlowNodes(p.flow, p.selectedNodeId, p.phaseRunStates),
);
// edges line unchanged

useEffect(() => {
  const sig = structuralSig(p.flow);
  if (sig === propagatedSigRef.current) {
    lastSigRef.current = sig;
    return;
  }
  if (sig !== lastSigRef.current || p.selectedNodeId !== lastSelectedRef.current) {
    lastSigRef.current = sig;
    lastSelectedRef.current = p.selectedNodeId;
    setNodes(toReactFlowNodes(p.flow, p.selectedNodeId, p.phaseRunStates));
    setEdges(toReactFlowEdges(p.flow));
  }
}, [p.flow, p.selectedNodeId, p.phaseRunStates, setNodes, setEdges]);
```

- Update `applyExternalChange`:

```ts
const applyExternalChange = useCallback((next: FlowGraph) => {
  setNodes(toReactFlowNodes(next, p.selectedNodeId, p.phaseRunStates));
  setEdges(toReactFlowEdges(next));
  propagate(next);
}, [setNodes, setEdges, propagate, p.selectedNodeId, p.phaseRunStates]);
```

- Update `handleDrop`'s phase-creation branch — the registry is now the source of label info:

```ts
const registry = usePhaseRegistry();
// …inside handleDrop, replace the `entry = p.catalog.find(...)` block:
if (phaseType) {
  const def = registry.get(phaseType);
  newNode = newPhaseNode({
    phaseType,
    displayName: def?.label ?? phaseType,
    position,
  });
  if (def) {
    newNode = {
      ...newNode,
      config: { ...(def.defaultConfig as Record<string, unknown>) },
      executorConfig: (() => {
        const opts = (def.executor.kind === "control") ? undefined : undefined;
        // resolve provider via the lookup
        return undefined;
      })(),
    };
  }
}
```

Replace the inline IIFE with a clean import-and-call. Final `handleDrop` phase branch:

```ts
import { defaultProviderFor } from "../executor-common-config.ts";
// …
if (phaseType) {
  const def = registry.get(phaseType);
  const base = newPhaseNode({
    phaseType,
    displayName: def?.label ?? phaseType,
    position,
  });
  newNode = def
    ? {
        ...base,
        config: { ...(def.defaultConfig as Record<string, unknown>) },
        executorConfig: (() => {
          const p = defaultProviderFor(def.executor.kind);
          return p ? { provider: p } : undefined;
        })(),
      }
    : base;
}
```

(The `useState` for `registry` must be hoisted to the top of `CanvasInner` so the `useCallback` for `handleDrop` can include it in its dep array.)

- [ ] **Step 4: Remove the now-unused `PhaseCatalog` import**

Delete the line `import type { PhaseCatalog } from "../types.ts";` if still present.

---

## Task 13: Update `Palette.tsx` to derive entries from `PhaseDefinition[]`

**Files:**
- Modify: `packages/flow-editor/src/palette/Palette.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// packages/flow-editor/src/palette/Palette.tsx
import { useMemo } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { ControlNodeCatalog } from "../types.ts";
import type { PhaseDefinition } from "../phase-definition.ts";

export interface PaletteProps {
  phases: PhaseDefinition[];
  controlCatalog?: ControlNodeCatalog;
}

type AnyEntry =
  | { kind: "phase";   phaseType: string; label: string; category: string; color: string; icon: string; description?: string }
  | { kind: "control"; nodeType: string;  label: string; category: string; color: string; icon: string; description?: string };

export function Palette({ phases, controlCatalog }: PaletteProps) {
  const entries = useMemo<AnyEntry[]>(() => [
    ...phases.map(p => ({
      kind: "phase" as const,
      phaseType: p.phaseType,
      label: p.label,
      category: p.category,
      color: p.color,
      icon: p.icon,
      description: p.description,
    })),
    ...(controlCatalog ?? []).map(c => ({ kind: "control" as const, ...c })),
  ], [phases, controlCatalog]);

  const grouped = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of entries) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [entries]);

  return (
    <aside className="je-editor__palette">
      <div className="je-palette__title" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Phases</div>
      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => (
            <PaletteItem
              key={it.kind === "phase" ? `phase:${it.phaseType}` : `control:${it.nodeType}`}
              entry={{ ...it, dragMime: it.kind === "phase" ? "application/journeyman-phase" : "application/journeyman-control" }}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}
```

---

## Task 14: Update `FlowEditor.tsx` — wire `PhaseRegistryProvider` and replace prop

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// packages/flow-editor/src/FlowEditor.tsx
import { useEffect, useMemo, useState } from "react";
import { Canvas } from "./canvas/Canvas.tsx";
import { PanelResizer } from "./canvas/PanelResizer.tsx";
import { Palette } from "./palette/Palette.tsx";
import { PropertiesPanel } from "./properties-panel/PropertiesPanel.tsx";
import { Topbar } from "./topbar/Topbar.tsx";
import { useFlowEditorState } from "./state/useFlowEditorState.ts";
import { isValidPhase4Graph } from "./state/validation.ts";
import { PhaseRegistryProvider } from "./state/phase-registry-context.tsx";
import type { FlowEditorProps } from "./types.ts";
import type { FlowNode } from "@journeyman/core";
import "./styles.css";

const PROPS_WIDTH_KEY = "je-editor:propsWidth";

export function FlowEditor(props: FlowEditorProps) {
  const s = useFlowEditorState({ flow: props.flow, onChange: props.onChange });
  const validity = useMemo(() => isValidPhase4Graph(props.flow), [props.flow]);

  const [propsWidth, setPropsWidth] = useState<number>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(PROPS_WIDTH_KEY) : null;
    const n = stored ? Number(stored) : NaN;
    return Number.isFinite(n) && n >= 220 && n <= 720 ? n : 320;
  });
  useEffect(() => {
    try { localStorage.setItem(PROPS_WIDTH_KEY, String(propsWidth)); } catch { /* ignore */ }
  }, [propsWidth]);

  const onUpdateNode = (next: FlowNode) => {
    s.update(f => ({ ...f, nodes: f.nodes.map(n => n.id === next.id ? next : n) }));
  };

  return (
    <PhaseRegistryProvider phases={props.phases}>
      <div className="je-editor">
        <Topbar
          flowName={props.flowName}
          onRename={props.onRename}
          onSave={props.onSave ? () => props.onSave!(props.flow) : undefined}
          onRun={props.onRun ? () => props.onRun!(props.flow) : undefined}
          busy={props.busy}
          saveEnabled={!props.readOnly && !!props.onSave}
          runEnabled={!props.readOnly && !!props.onRun && validity.ok}
          runDisabledReason={validity.ok ? undefined : validity.errors[0]}
          validationErrors={validity.errors}
        />
        <div
          className="je-editor__body"
          style={{ gridTemplateColumns: `200px 1fr 6px ${propsWidth}px` }}
        >
          <Palette phases={props.phases} controlCatalog={props.controlCatalog} />
          <Canvas
            flow={props.flow}
            selectedNodeId={s.selectedNodeId}
            onSelect={s.setSelectedNodeId}
            onChange={props.onChange}
            readOnly={props.readOnly}
            phaseRunStates={props.phaseRunStates}
          />
          <PanelResizer width={propsWidth} onResize={setPropsWidth} side="right" />
          <PropertiesPanel
            flow={props.flow}
            node={s.selectedNode}
            mcpCatalog={props.mcpCatalog ?? []}
            onChange={onUpdateNode}
            readOnly={props.readOnly}
          />
        </div>
      </div>
    </PhaseRegistryProvider>
  );
}
```

---

## Task 15: Update `flow-editor/src/index.ts` exports

**Files:**
- Modify: `packages/flow-editor/src/index.ts`

- [ ] **Step 1: Replace the file**

```ts
// packages/flow-editor/src/index.ts
export { FlowEditor } from "./FlowEditor.tsx";
export { createBlankFlow, isLinearAndComplete, isValidPhase4Graph } from "./state/flow-graph.ts";
export type {
  FlowEditorProps,
  ControlNodeCatalog, ControlNodeCatalogEntry,
  McpCatalog, McpCatalogEntry,
} from "./types.ts";
export type {
  PhaseDefinition,
  PhaseRunState,
  PhaseFormProps,
  FieldMeta,
  TabVisibility,
  ExecutorKind,
} from "./phase-definition.ts";
export { executorCommonConfig, defaultProviderFor } from "./executor-common-config.ts";
export { PhaseRegistry } from "./state/phase-registry.ts";
export { defaultControlCatalog } from "./palette/built-in-categories.ts";
export { defaultMcpCatalog } from "./catalogs/built-in-mcp-catalog.ts";
export { nodeTypes, edgeTypes } from "./canvas/node-registry.ts";
```

---

## Task 16: Create the `@journeyman/phases` package skeleton

**Files:**
- Create: `packages/phases/package.json`
- Create: `packages/phases/tsconfig.json`
- Create: `packages/phases/src/index.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@journeyman/phases",
  "version": "0.1.0",
  "description": "Built-in phase definitions for the Journeyman flow editor.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/flow-editor": "*",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "react": "^18.3.1",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: `src/index.ts` placeholder (to be filled in Task 17)**

```ts
// packages/phases/src/index.ts
export { builtInPhases } from "./registry.ts";
```

- [ ] **Step 4: Install workspace links**

From repo root, run: `npm install`
Expected: completes without error; `node_modules/@journeyman/phases` symlink is created.

---

## Task 17: Create `phases/src/registry.ts` — assembles `builtInPhases`

This file imports each phase definition and exposes them as one array.

**Files:**
- Create: `packages/phases/src/registry.ts`

- [ ] **Step 1: Create the registry file**

```ts
// packages/phases/src/registry.ts
import type { PhaseDefinition } from "@journeyman/flow-editor";

import { analyzePhase } from "./ai/analyze.tsx";
import { planPhase } from "./ai/plan.tsx";
import { implementPhase } from "./ai/implement.tsx";

import { scanReposPhase } from "./repos/scan-repos.tsx";
import { checkoutRepoPhase } from "./repos/checkout-repo.tsx";
import { commitPushPhase } from "./repos/commit-push.tsx";
import { cleanupReposPhase } from "./repos/cleanup-repos.tsx";
import { createWorkspacePhase } from "./repos/create-workspace.tsx";

import { getRepoPhase } from "./git/get-repo.tsx";
import { createPrPhase } from "./git/create-pr.tsx";
import { listPrsPhase } from "./git/list-prs.tsx";

import { createTicketPhase } from "./tickets/create-ticket.tsx";
import { updateTicketPhase } from "./tickets/update-ticket.tsx";

import { sendSlackMessagePhase } from "./notifications/send-slack-message.tsx";

export const builtInPhases: PhaseDefinition[] = [
  // AI
  analyzePhase, planPhase, implementPhase,
  // Repos
  scanReposPhase, checkoutRepoPhase, commitPushPhase, cleanupReposPhase, createWorkspacePhase,
  // Git
  getRepoPhase, createPrPhase, listPrsPhase,
  // Tickets
  createTicketPhase, updateTicketPhase,
  // Notifications
  sendSlackMessagePhase,
];
```

(The imports will fail to resolve until Tasks 18–22 create the files. That's expected — the final typecheck in Task 24 catches everything together.)

---

## Task 18: AI phase definitions (analyze, plan, implement)

**Files:**
- Create: `packages/phases/src/ai/analyze.tsx`
- Create: `packages/phases/src/ai/plan.tsx`
- Create: `packages/phases/src/ai/implement.tsx`

Common values for AI phases: `category: "AI"`, tabs `{ io: "shown", credentials: "required", mcp: "shown", retry: "shown" }`.

- [ ] **Step 1: `analyze.tsx`** (preserves color/icon from today's catalog entry)

```tsx
// packages/phases/src/ai/analyze.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface AnalyzeConfig {
  ticketKey: string;
  repoPath: string;
  instructions?: string;
}

export const analyzePhase: PhaseDefinition<AnalyzeConfig> = {
  phaseType: "analyze",
  label: "Analyze",
  category: "AI",
  description: "Analyze a repo against a ticket using a coding-cli provider.",
  color: "#00b894",
  icon: "🤖",
  defaultConfig: { ticketKey: "", repoPath: "", instructions: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1, "ticketKey is required"),
    repoPath: z.string().min(1, "repoPath is required"),
    instructions: z.string().optional(),
  }),
  configFields: {
    ticketKey:    { label: "Ticket key",    widget: "text",     help: "e.g. PROJ-123" },
    repoPath:     { label: "Repo path",     widget: "text",     help: "Local path or workspace ref" },
    instructions: { label: "Extra instructions", widget: "textarea", help: "Optional additional analysis instructions" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: c => c.ticketKey || "(no ticket)",
  executor: { kind: "coding-cli", method: "analyze" },
};
```

- [ ] **Step 2: `plan.tsx`**

```tsx
// packages/phases/src/ai/plan.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface PlanConfig {
  ticketKey: string;
  repoPath: string;
  analysisRef?: string;
}

export const planPhase: PhaseDefinition<PlanConfig> = {
  phaseType: "plan",
  label: "Plan",
  category: "AI",
  description: "Produce an implementation plan from a ticket and (optionally) a prior analysis.",
  color: "#0984e3",
  icon: "📝",
  defaultConfig: { ticketKey: "", repoPath: "", analysisRef: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
    repoPath: z.string().min(1),
    analysisRef: z.string().optional(),
  }),
  configFields: {
    ticketKey:   { label: "Ticket key", widget: "text" },
    repoPath:    { label: "Repo path",  widget: "text" },
    analysisRef: { label: "Analysis ref", widget: "text", help: "Optional reference to a prior analyze output" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: c => c.ticketKey || "(no ticket)",
  executor: { kind: "coding-cli", method: "plan" },
};
```

- [ ] **Step 3: `implement.tsx`**

```tsx
// packages/phases/src/ai/implement.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface ImplementConfig {
  planRef: string;
  repoPath: string;
}

export const implementPhase: PhaseDefinition<ImplementConfig> = {
  phaseType: "implement",
  label: "Implement",
  category: "AI",
  description: "Execute a plan against a repo using a coding-cli provider.",
  color: "#6c5ce7",
  icon: "🛠",
  defaultConfig: { planRef: "", repoPath: "" },
  configSchema: z.object({
    planRef: z.string().min(1),
    repoPath: z.string().min(1),
  }),
  configFields: {
    planRef:  { label: "Plan ref", widget: "text", help: "Reference to a plan-phase output" },
    repoPath: { label: "Repo path", widget: "text" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: c => c.planRef || "(no plan)",
  executor: { kind: "coding-cli", method: "implement" },
};
```

---

## Task 19: Repos phase definitions

Common values: `category: "Repos"`, tabs `{ io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" }`.

**Files:**
- Create: `packages/phases/src/repos/scan-repos.tsx`
- Create: `packages/phases/src/repos/checkout-repo.tsx`
- Create: `packages/phases/src/repos/commit-push.tsx`
- Create: `packages/phases/src/repos/cleanup-repos.tsx`
- Create: `packages/phases/src/repos/create-workspace.tsx`

- [ ] **Step 1: `scan-repos.tsx`**

```tsx
// packages/phases/src/repos/scan-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface ScanReposConfig {
  workspaceDir: string;
  pattern: string;
}

export const scanReposPhase: PhaseDefinition<ScanReposConfig> = {
  phaseType: "scan-repos",
  label: "Scan Repos",
  category: "Repos",
  description: "Scan a workspace for repositories matching a pattern.",
  color: "#fdcb6e",
  icon: "🔍",
  defaultConfig: { workspaceDir: "", pattern: "*" },
  configSchema: z.object({
    workspaceDir: z.string().min(1),
    pattern: z.string().min(1),
  }),
  configFields: {
    workspaceDir: { label: "Workspace dir", widget: "text" },
    pattern:      { label: "Glob pattern",  widget: "text", help: "e.g. */api-*" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.pattern || c.workspaceDir,
  executor: { kind: "coding-cli", method: "scanRepos" },
};
```

- [ ] **Step 2: `checkout-repo.tsx`**

```tsx
// packages/phases/src/repos/checkout-repo.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CheckoutRepoConfig {
  url: string;
  branch?: string;
  targetDir: string;
}

export const checkoutRepoPhase: PhaseDefinition<CheckoutRepoConfig> = {
  phaseType: "checkout-repo",
  label: "Checkout Repo",
  category: "Repos",
  description: "Clone or update a repository to a target directory.",
  color: "#fdcb6e",
  icon: "⬇",
  defaultConfig: { url: "", branch: "", targetDir: "" },
  configSchema: z.object({
    url: z.string().min(1),
    branch: z.string().optional(),
    targetDir: z.string().min(1),
  }),
  configFields: {
    url:       { label: "Repo URL",   widget: "text" },
    branch:    { label: "Branch",     widget: "text", help: "Defaults to repo default branch" },
    targetDir: { label: "Target dir", widget: "text" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.branch ? `${c.url}@${c.branch}` : c.url,
  executor: { kind: "coding-cli", method: "checkoutRepo" },
};
```

- [ ] **Step 3: `commit-push.tsx`**

```tsx
// packages/phases/src/repos/commit-push.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CommitPushConfig {
  repoPath: string;
  message: string;
  branch?: string;
}

export const commitPushPhase: PhaseDefinition<CommitPushConfig> = {
  phaseType: "commit-push",
  label: "Commit & Push",
  category: "Repos",
  description: "Stage all changes, commit, and push to remote.",
  color: "#fdcb6e",
  icon: "⬆",
  defaultConfig: { repoPath: "", message: "", branch: "" },
  configSchema: z.object({
    repoPath: z.string().min(1),
    message: z.string().min(1),
    branch: z.string().optional(),
  }),
  configFields: {
    repoPath: { label: "Repo path", widget: "text" },
    message:  { label: "Commit message", widget: "textarea" },
    branch:   { label: "Branch", widget: "text", help: "Defaults to current branch" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.message ? `“${c.message.slice(0, 40)}”` : c.repoPath,
  executor: { kind: "coding-cli", method: "commitPushRepos" },
};
```

- [ ] **Step 4: `cleanup-repos.tsx`**

```tsx
// packages/phases/src/repos/cleanup-repos.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CleanupReposConfig {
  workspaceDir: string;
  mode: "soft" | "hard";
}

export const cleanupReposPhase: PhaseDefinition<CleanupReposConfig> = {
  phaseType: "cleanup-repos",
  label: "Cleanup Repos",
  category: "Repos",
  description: "Reset and optionally delete repos in a workspace.",
  color: "#fdcb6e",
  icon: "🧹",
  defaultConfig: { workspaceDir: "", mode: "soft" },
  configSchema: z.object({
    workspaceDir: z.string().min(1),
    mode: z.enum(["soft", "hard"]),
  }),
  configFields: {
    workspaceDir: { label: "Workspace dir", widget: "text" },
    mode: {
      label: "Mode", widget: "select",
      options: [
        { value: "soft", label: "Soft (reset working tree)" },
        { value: "hard", label: "Hard (delete repos)" },
      ],
    },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => `${c.mode}: ${c.workspaceDir}`,
  executor: { kind: "coding-cli", method: "cleanupRepos" },
};
```

- [ ] **Step 5: `create-workspace.tsx`**

```tsx
// packages/phases/src/repos/create-workspace.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CreateWorkspaceConfig {
  name: string;
  baseDir: string;
}

export const createWorkspacePhase: PhaseDefinition<CreateWorkspaceConfig> = {
  phaseType: "create-workspace",
  label: "Create Workspace",
  category: "Repos",
  description: "Create a new workspace directory for repo operations.",
  color: "#fdcb6e",
  icon: "📁",
  defaultConfig: { name: "", baseDir: "" },
  configSchema: z.object({
    name: z.string().min(1),
    baseDir: z.string().min(1),
  }),
  configFields: {
    name:    { label: "Workspace name", widget: "text" },
    baseDir: { label: "Base directory", widget: "text" },
  },
  tabs: { io: "shown", credentials: "hidden", mcp: "hidden", retry: "shown" },
  summary: c => c.name || c.baseDir,
  executor: { kind: "coding-cli", method: "createWorkspace" },
};
```

---

## Task 20: Git phase definitions

Common values: `category: "Git"`, tabs `{ io: "shown", credentials: "required", mcp: "hidden", retry: "shown" }`.

**Files:**
- Create: `packages/phases/src/git/get-repo.tsx`
- Create: `packages/phases/src/git/create-pr.tsx`
- Create: `packages/phases/src/git/list-prs.tsx`

- [ ] **Step 1: `get-repo.tsx`**

```tsx
// packages/phases/src/git/get-repo.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface GetRepoConfig {
  owner: string;
  repo: string;
}

export const getRepoPhase: PhaseDefinition<GetRepoConfig> = {
  phaseType: "get-repo",
  label: "Get Repo",
  category: "Git",
  description: "Fetch metadata for a remote repository.",
  color: "#74b9ff",
  icon: "🗂",
  defaultConfig: { owner: "", repo: "" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  }),
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository",  widget: "text" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo}` : "",
  executor: { kind: "git-provider", method: "getRepo" },
};
```

- [ ] **Step 2: `create-pr.tsx`**

```tsx
// packages/phases/src/git/create-pr.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CreatePrConfig {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export const createPrPhase: PhaseDefinition<CreatePrConfig> = {
  phaseType: "create-pr",
  label: "Create PR",
  category: "Git",
  description: "Open a pull/merge request on the remote.",
  color: "#74b9ff",
  icon: "🔀",
  defaultConfig: { owner: "", repo: "", title: "", body: "", head: "", base: "main" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    head: z.string().min(1),
    base: z.string().min(1),
  }),
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository", widget: "text" },
    title: { label: "Title", widget: "text" },
    body:  { label: "Body",  widget: "textarea" },
    head:  { label: "Head branch", widget: "text" },
    base:  { label: "Base branch", widget: "text" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.head && c.base ? `${c.base} ← ${c.head}` : (c.title || ""),
  executor: { kind: "git-provider", method: "createPR" },
};
```

- [ ] **Step 3: `list-prs.tsx`**

```tsx
// packages/phases/src/git/list-prs.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface ListPrsConfig {
  owner: string;
  repo: string;
  state: "open" | "closed" | "all";
}

export const listPrsPhase: PhaseDefinition<ListPrsConfig> = {
  phaseType: "list-prs",
  label: "List PRs",
  category: "Git",
  description: "List pull/merge requests by state.",
  color: "#74b9ff",
  icon: "📋",
  defaultConfig: { owner: "", repo: "", state: "open" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    state: z.enum(["open", "closed", "all"]),
  }),
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository", widget: "text" },
    state: {
      label: "State", widget: "select",
      options: [
        { value: "open",   label: "Open"   },
        { value: "closed", label: "Closed" },
        { value: "all",    label: "All"    },
      ],
    },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo} [${c.state}]` : "",
  executor: { kind: "git-provider", method: "listPRs" },
};
```

---

## Task 21: Tickets phase definitions (incl. custom form for `update-ticket`)

Common values: `category: "Tickets"`, tabs `{ io: "shown", credentials: "required", mcp: "hidden", retry: "shown" }`.

**Files:**
- Create: `packages/phases/src/tickets/create-ticket.tsx`
- Create: `packages/phases/src/tickets/update-ticket.tsx`

- [ ] **Step 1: `create-ticket.tsx`**

```tsx
// packages/phases/src/tickets/create-ticket.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CreateTicketConfig {
  project: string;
  title: string;
  description: string;
  labels: string[];
}

export const createTicketPhase: PhaseDefinition<CreateTicketConfig> = {
  phaseType: "create-ticket",
  label: "Create Ticket",
  category: "Tickets",
  description: "Create a ticket on the configured tracker.",
  color: "#a29bfe",
  icon: "🎫",
  defaultConfig: { project: "", title: "", description: "", labels: [] },
  configSchema: z.object({
    project: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    labels: z.array(z.string()),
  }),
  configFields: {
    project:     { label: "Project key", widget: "text" },
    title:       { label: "Title", widget: "text" },
    description: { label: "Description", widget: "textarea" },
    // labels rendered as comma-separated string for round 1; the schema enforces array shape via the form's array handling below.
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.title || c.project,
  executor: { kind: "ticket-provider", method: "createTicket" },
};
```

Note on labels: the generic `SchemaForm` does not render arrays. For round 1, accept this limitation — labels stay at their default `[]` and can only be edited if a future task adds a custom form. The schema still validates serialized state on save.

- [ ] **Step 2: `update-ticket.tsx`** (custom `ConfigForm` for the dynamic `fields` map)

```tsx
// packages/phases/src/tickets/update-ticket.tsx
import { z } from "zod";
import type { PhaseDefinition, PhaseFormProps } from "@journeyman/flow-editor";

interface UpdateTicketConfig {
  ticketKey: string;
  fields: Record<string, string>;
}

function UpdateTicketConfigForm({ config, onChange, readOnly }: PhaseFormProps<UpdateTicketConfig>) {
  const set = (key: string, value: string) => onChange({ ...config, fields: { ...config.fields, [key]: value } });
  const remove = (key: string) => {
    const next = { ...config.fields };
    delete next[key];
    onChange({ ...config, fields: next });
  };
  const addEmpty = () => {
    let i = 1;
    while (config.fields[`field${i}`] !== undefined) i += 1;
    onChange({ ...config, fields: { ...config.fields, [`field${i}`]: "" } });
  };

  return (
    <div>
      <div className="je-props__field">
        <label>Ticket key</label>
        <input
          type="text"
          value={config.ticketKey}
          disabled={readOnly}
          onChange={e => onChange({ ...config, ticketKey: e.target.value })}
        />
      </div>
      <div className="je-props__field">
        <label>Fields</label>
        {Object.entries(config.fields).map(([key, value]) => (
          <div key={key} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              type="text"
              value={key}
              disabled={readOnly}
              onChange={e => {
                const newKey = e.target.value;
                if (newKey === key) return;
                const next = { ...config.fields };
                delete next[key];
                next[newKey] = value;
                onChange({ ...config, fields: next });
              }}
              style={{ flex: 1 }}
            />
            <input
              type="text"
              value={value}
              disabled={readOnly}
              onChange={e => set(key, e.target.value)}
              style={{ flex: 2 }}
            />
            {!readOnly && (
              <button type="button" onClick={() => remove(key)}>×</button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={addEmpty}>+ Add field</button>
        )}
        {/* TODO: provider-specific field editor (Jira/Linear/Monday) */}
      </div>
    </div>
  );
}

export const updateTicketPhase: PhaseDefinition<UpdateTicketConfig> = {
  phaseType: "update-ticket",
  label: "Update Ticket",
  category: "Tickets",
  description: "Update fields on an existing ticket.",
  color: "#a29bfe",
  icon: "✏️",
  defaultConfig: { ticketKey: "", fields: {} },
  configSchema: z.object({
    ticketKey: z.string().min(1),
    fields: z.record(z.string(), z.string()),
  }),
  ConfigForm: UpdateTicketConfigForm,
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.ticketKey || "(no ticket)",
  executor: { kind: "ticket-provider", method: "updateTicket" },
};
```

---

## Task 22: Notifications phase definition (Slack)

Common values: `category: "Notifications"`, tabs `{ io: "hidden", credentials: "required", mcp: "hidden", retry: "shown" }`.

**Files:**
- Create: `packages/phases/src/notifications/send-slack-message.tsx`

- [ ] **Step 1: `send-slack-message.tsx`**

```tsx
// packages/phases/src/notifications/send-slack-message.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface SendSlackMessageConfig {
  channel: string;
  message: string;
  blocks?: string;
}

export const sendSlackMessagePhase: PhaseDefinition<SendSlackMessageConfig> = {
  phaseType: "send-slack-message",
  label: "Send Slack Message",
  category: "Notifications",
  description: "Post a message to a Slack channel.",
  color: "#fd79a8",
  icon: "💬",
  defaultConfig: { channel: "", message: "", blocks: "" },
  configSchema: z.object({
    channel: z.string().min(1),
    message: z.string().min(1),
    blocks: z.string().optional(),
  }),
  configFields: {
    channel: { label: "Channel", widget: "text", help: "e.g. #deploys" },
    message: { label: "Message", widget: "textarea" },
    blocks:  { label: "Block Kit JSON (optional)", widget: "code", help: "Raw JSON for rich formatting" },
  },
  tabs: { io: "hidden", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.channel || "(no channel)",
  executor: { kind: "notification", method: "sendMessage" },
};
```

---

## Task 23: Update the web app — wire `builtInPhases`

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`
- Delete: `packages/web/src/catalogs/built-in-phase-catalog.ts`

- [ ] **Step 1: Add the dependency**

In `packages/web/package.json`, add `"@journeyman/phases": "*"` to `dependencies` (alphabetically, after `@journeyman/flow-editor`).

- [ ] **Step 2: Re-link workspaces**

From repo root, run: `npm install`
Expected: completes without error; `node_modules/@journeyman/phases` is symlinked under `packages/web`.

- [ ] **Step 3: Update `FlowEditorPage.tsx`**

Replace the import and prop. In `packages/web/src/routes/FlowEditorPage.tsx`:

- Replace `import { builtInPhaseCatalog } from "../catalogs/built-in-phase-catalog.ts";` with `import { builtInPhases } from "@journeyman/phases";`.
- Replace `phaseCatalog={builtInPhaseCatalog}` with `phases={builtInPhases}`.

- [ ] **Step 4: Delete the now-unused catalog file**

Run: `rm packages/web/src/catalogs/built-in-phase-catalog.ts`
Expected: file removed, no other consumers (we already replaced the only one).

---

## Task 24: Final verification — typecheck

**Files:** none

- [ ] **Step 1: Run typecheck across the workspace**

From repo root, run: `npm run typecheck`
Expected: every workspace package's `tsc --noEmit` passes with no errors. Resolve any reported errors before declaring the implementation complete.

- [ ] **Step 2: Visual smoke (manual, performed by the user)**

Per spec verification checklist: open the web flow editor, drag each of the 14 phases onto the canvas, fill in fields, confirm tab visibility, canvas subtitles, and the executor-block dropdown options.

The user will commit the changes after their review. Do not commit.

---

## Self-Review Notes

**Spec coverage:**
- §"The PhaseDefinition Adapter" → Task 2.
- §"Executor-Kind Common Config" → Tasks 1, 3, 7, 10, 12.
- §"Common Tab Visibility" → Task 8 (TabsShell), Task 9 (PropertiesPanel filtering).
- §"Canvas Display" → Tasks 11 (PhaseNode subtitle + status badge) and 12 (Canvas wires `phaseRunStates` through the data shape).
- §"The 14-Phase Catalog" → Tasks 18–22.
- §"Editor Integration" → Tasks 4, 9, 10, 12, 13, 14, 15.
- §"Web-side Changes" → Task 23.
- §"Backwards Compatibility" — defaults filled in by `defaultConfig` plus the `phaseType-change` handler in Task 10's `ConfigTab`.

**Type consistency check:**
- `PhaseDefinition` shape in Task 2 matches usage everywhere (Tasks 5, 6, 7, 9–14, 17–22).
- `PhaseRunState` defined in Task 2; consumed in Task 11 (PhaseNode), produced/threaded through Task 12 (Canvas).
- `executorCommonConfig`/`defaultProviderFor` defined in Task 3; consumed in Tasks 7, 10, 12.
- `TabsVisibility` defined in Task 8; consumed in Task 9.
- `executorConfig` shape `{ provider?: string }` matches across core (Task 1), ExecutorBlock (Task 7), ConfigTab (Task 10), and Canvas drop handler (Task 12).

**No placeholder lingering:**
- Round-1 array-field limitation on `create-ticket.labels` is called out explicitly in Task 21 with a marked `// TODO`. This is documented in the spec under Risks; not a hidden TBD.
