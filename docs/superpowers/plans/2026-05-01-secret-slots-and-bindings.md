# Secret Slots & Bindings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-node `requiredSecrets: string[]` model with named slots declared per phase + bindings per node (`auto` or `pinned`), and close the runtime gap so user/org secrets actually reach providers.

**Architecture:** Each phase declares a list of named credential slots. Each node binds every slot to either `auto` (resolver picks by slot name through user > org > global) or `pinned` (specific scope+name, no fallback). At runtime the worker resolves all bindings to a slot-keyed env and hands it to the handler, which builds its provider per call with tokens from that env. Old `requiredSecrets[]` flows are migrated to all-`auto` bindings on read.

**Tech Stack:** TypeScript, React, Fastify, Postgres, `@journeyman/secrets`, `@journeyman/core`.

**Per-user constraints:** No commits. No unit tests. No per-task typecheck — single final typecheck at the end.

**Spec:** `docs/superpowers/specs/2026-04-30-secret-slots-and-bindings-design.md`

---

## File map

**New files:**
- `packages/secrets/src/resolve-bindings.ts` — `resolveBindings()` + DB helpers for pinned (scope, name) lookups.

**Modified files:**
- `packages/core/src/types/flow.types.ts` — add `SecretBinding`, replace `FlowNode.requiredSecrets` with `secretBindings`, extend `FlowSaveWarning` union.
- `packages/core/src/index.ts` — export new types.
- `packages/secrets/src/db.ts` — add `fetchPinnedSecret(orgId, userId, name)` + `fetchOrgPinnedSecret(orgId, name)`.
- `packages/secrets/src/index.ts` — export `resolveBindings`.
- `packages/api-server/src/schemas/update-flow.ts` — zod schema for `secretBindings`; reject `requiredSecrets`.
- `packages/api-server/src/routes/flows.ts` — rewrite `computeSaveWarnings` to walk bindings; add `cross_scope_pin` warning.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — emit Conductor task input from `secretBindings`; one-time read-side migration of legacy `requiredSecrets`.
- `packages/orchestrator/src/workers/worker-harness.ts` — call `resolveBindings`, build slot-keyed `ctx.env`, stop merging `process.env`.
- `packages/orchestrator/src/cli-worker.ts` — fail-fast on any pinned binding (no run context).
- `packages/git-provider/src/providers/github/index.ts` — `token` is required; remove `tokenEnv` / `process.env` fallbacks.
- `packages/ticket-provider/src/providers/github-issues/index.ts` — same.
- `packages/ticket-provider/src/providers/github-projects/index.ts` — same.
- `packages/ticket-provider/src/providers/jira/index.ts` (and `mcp-config.ts`) — accept token via opts.
- `packages/coding-cli/src/providers/claude/index.ts` — accept optional `apiKey` via opts; passed through to SDK.
- All phase handlers under `packages/orchestrator/src/workers/phases/` that use providers — build the provider inside `run()` from `ctx.env`.
- `packages/api-server/src/composition.ts` — provider factories (closures) instead of long-lived instances.
- `packages/flow-editor/src/phase-definition.ts` — replace `defaultRequiredSecrets` / `optionalSecrets` with `slots: SecretSlotDef[]`.
- `packages/flow-editor/src/canvas/Canvas.tsx` — seed `node.secretBindings` from `slots` (all `auto`) on palette drop.
- `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` — full rebuild as slot rows + binding picker + preview.
- `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` — adjust `requiredEmpty` calc.
- `packages/flow-editor/src/topbar/Topbar.tsx` — render new `cross_scope_pin` warning code.
- `packages/web/src/api/flows.ts` — extend `FlowValidationReport` for new warning code.
- All phase definition files in `packages/phases/src/{tickets,git,repos,ai,notifications}/*.tsx` — replace `defaultRequiredSecrets`/`optionalSecrets` with `slots`.

---

## Task 1: Core types — SecretBinding, FlowNode update, FlowSaveWarning extension

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Replace `requiredSecrets` field on `FlowNode` and add `SecretBinding` type**

In `packages/core/src/types/flow.types.ts`, find the `FlowNode` interface and replace the `requiredSecrets` field:

```ts
export interface FlowNode {
  // ...existing fields above unchanged...

  /** Per-slot binding map. Key is the slot name from the phase definition. */
  secretBindings?: Record<string, SecretBinding>;

  /** Position on canvas — opaque to engine; preserved on round-trip. */
  position?: { x: number; y: number };
  /** Only meaningful on `end` nodes — surfaced as the run's outcome label. */
  outcome?: string;
}

/** How a single slot resolves at runtime. */
export type SecretBinding =
  | { mode: "auto" }
  | { mode: "pinned"; scope: SecretScope; name: string };
```

Delete the existing `requiredSecrets?: string[]` field and its surrounding doc-comment. Add an `import type { SecretScope } from "./secrets.types.ts";` near the top of the file if not already present.

- [ ] **Step 2: Extend `FlowSaveWarning` with `cross_scope_pin`**

In the same file, find the existing `FlowSaveWarning` type and change it to:

```ts
export type FlowSaveWarning =
  | {
      code: "inaccessible_secrets";
      message: string;
      names: string[];
    }
  | {
      code: "cross_scope_pin";
      message: string;
      entries: Array<{
        nodeId: string;
        slot: string;
        pinnedScope: SecretScope;
        flowScope: FlowScope;
      }>;
    };
```

- [ ] **Step 3: Export new types from `@journeyman/core`**

In `packages/core/src/index.ts`, find the existing export block for `flow.types.ts`:

```ts
export type {
  Flow, FlowGraph, FlowEdge, FlowEdgeType, FlowNode, FlowNodeType, FlowVersion,
  FlowSchemaVersion,
  RetryPolicy, FlowRetryPolicy, BackoffStrategy,
  McpServerConfig, McpTransport, FlowInputValue, RunInputDef,
  FlowSaveWarning,
} from "./types/flow.types.ts";
```

Replace it with:

```ts
export type {
  Flow, FlowGraph, FlowEdge, FlowEdgeType, FlowNode, FlowNodeType, FlowVersion,
  FlowSchemaVersion,
  RetryPolicy, FlowRetryPolicy, BackoffStrategy,
  McpServerConfig, McpTransport, FlowInputValue, RunInputDef,
  FlowSaveWarning,
  SecretBinding,
} from "./types/flow.types.ts";
```

---

## Task 2: DB helpers for pinned lookups

**Files:**
- Modify: `packages/secrets/src/db.ts`

- [ ] **Step 1: Add `fetchPinnedUserSecret` and `fetchPinnedOrgSecret`**

Append the two helpers at the bottom of `packages/secrets/src/db.ts` (after the existing exports):

```ts
import { open } from "./crypto.ts";

/** Fetch and decrypt one user-scope secret by exact (orgId, userId, name). */
export async function fetchPinnedUserSecret(
  pool: Pool,
  orgId: string,
  userId: string,
  name: string,
): Promise<string | null> {
  validateName(name);
  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE org_id = $1 AND user_id = $2 AND name = $3`,
    [orgId, userId, name],
  );
  const row = r.rows[0];
  if (!row) return null;
  return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
}

/** Fetch and decrypt one org-scope secret by exact (orgId, name). */
export async function fetchPinnedOrgSecret(
  pool: Pool,
  orgId: string,
  name: string,
): Promise<string | null> {
  validateName(name);
  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE org_id = $1 AND user_id IS NULL AND name = $2`,
    [orgId, name],
  );
  const row = r.rows[0];
  if (!row) return null;
  return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
}
```

If `import { open } from "./crypto.ts";` is already at the top, delete the duplicate import line and keep only the existing one.

---

## Task 3: `resolveBindings()` resolver

**Files:**
- Create: `packages/secrets/src/resolve-bindings.ts`
- Modify: `packages/secrets/src/index.ts`

- [ ] **Step 1: Create the resolver**

```ts
// packages/secrets/src/resolve-bindings.ts
import type { Pool } from "pg";
import {
  MissingSecretsError,
  type RunContext,
  type SecretBinding,
} from "@journeyman/core";
import { validateName } from "./db.ts";
import { fetchPinnedUserSecret, fetchPinnedOrgSecret } from "./db.ts";
import { resolveSecrets } from "./resolver.ts";
import { readGlobalSecrets } from "./global.ts";

export interface SecretSlotSpec {
  name: string;
  optional?: boolean;
}

export interface ResolveBindingsInput {
  pool: Pool;
  ctx: RunContext;
  bindings: Record<string, SecretBinding>;
  slots: SecretSlotSpec[];
}

export interface ResolveBindingsResult {
  values: Record<string, string>;
}

/**
 * Resolve every slot to a concrete value.
 *
 * - mode "pinned" → fetch exactly (scope, name); missing → MissingSecretsError.
 * - mode "auto"   → walk user > org > global on the slot's name; missing +
 *                   slot.optional → omit; missing + required → MissingSecretsError.
 */
export async function resolveBindings(input: ResolveBindingsInput): Promise<ResolveBindingsResult> {
  const { pool, ctx, bindings, slots } = input;
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const slot of slots) {
    validateName(slot.name);
    const binding = bindings[slot.name] ?? { mode: "auto" as const };

    if (binding.mode === "pinned") {
      validateName(binding.name);
      let v: string | null = null;
      if (binding.scope === "user") {
        v = await fetchPinnedUserSecret(pool, ctx.org.id, ctx.user.id, binding.name);
      } else if (binding.scope === "org") {
        v = await fetchPinnedOrgSecret(pool, ctx.org.id, binding.name);
      } else if (binding.scope === "global") {
        v = readGlobalSecrets()[binding.name] ?? null;
      }
      if (v == null) { missing.push(slot.name); continue; }
      values[slot.name] = v;
      continue;
    }

    // mode "auto" — single-name resolve through user > org > global.
    try {
      const r = await resolveSecrets({ pool, ctx, names: [slot.name] });
      values[slot.name] = r.values[slot.name];
    } catch (err) {
      if (err instanceof MissingSecretsError) {
        if (!slot.optional) missing.push(slot.name);
        continue;
      }
      throw err;
    }
  }

  if (missing.length > 0) throw new MissingSecretsError(missing);
  return { values };
}
```

- [ ] **Step 2: Export from package index**

In `packages/secrets/src/index.ts`, add the export line after the existing `visibility.ts` export:

```ts
export * from "./crypto.ts";
export * from "./global.ts";
export * from "./resolver.ts";
export * from "./credential-store.ts";
export * from "./visibility.ts";
export * from "./resolve-bindings.ts";
export { registerSecretsRoutes } from "./routes/index.ts";
```

---

## Task 4: PhaseDefinition slots model

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 1: Replace `defaultRequiredSecrets`/`optionalSecrets` with `slots`**

In `packages/flow-editor/src/phase-definition.ts`, find the existing two fields:

```ts
  defaultRequiredSecrets?: string[];
  optionalSecrets?: string[];
```

Replace them with:

```ts
  /** Credential slots this phase needs at run time. Each slot becomes a
   *  row in the editor's "Required secrets" tab and a key in ctx.env. */
  slots?: SecretSlotDef[];
```

Then add the `SecretSlotDef` type, near the other interfaces in the file (e.g. just below `FieldMeta`):

```ts
export interface SecretSlotDef {
  /** Slot identifier — what the phase reads at runtime as ctx.env[name].
   *  Convention: SCREAMING_SNAKE_CASE. Validated against ^[A-Z][A-Z0-9_]*$. */
  name: string;
  /** Short, human-friendly explanation. Shown next to the slot in the editor. */
  description: string;
  /** Optional slots: Auto-mode failing to resolve does NOT fail the run.
   *  Phase handler must tolerate ctx.env[name] being undefined. */
  optional?: boolean;
}
```

Also delete any leftover doc-comment that referenced `defaultRequiredSecrets`.

---

## Task 5: Phase definitions — declare slots

Convert every phase that currently has `defaultRequiredSecrets` or `optionalSecrets` to use `slots`. Each entry below shows the **exact replacement** for its `tabs:` line and the lines around it.

**Files (all modified):**
- `packages/phases/src/tickets/get-ticket.tsx`
- `packages/phases/src/tickets/create-ticket.tsx`
- `packages/phases/src/tickets/comment-on-ticket.tsx`
- `packages/phases/src/tickets/transition-ticket.tsx`
- `packages/phases/src/tickets/update-ticket-fields.tsx`
- `packages/phases/src/git/clone-repos.tsx`
- `packages/phases/src/git/comment-on-pull-request.tsx`
- `packages/phases/src/git/get-repository.tsx`
- `packages/phases/src/git/list-pull-requests.tsx`
- `packages/phases/src/git/open-pull-request.tsx`
- `packages/phases/src/git/list-pull-request-comments.tsx`
- `packages/phases/src/repos/commit-and-push.tsx`
- `packages/phases/src/repos/start-feature-branch.tsx`
- `packages/phases/src/ai/analyze-repo.tsx`
- `packages/phases/src/ai/plan-implementation.tsx`
- `packages/phases/src/ai/implement-changes.tsx`
- `packages/phases/src/notifications/send-message.tsx`

- [ ] **Step 1: Tickets — Get / Create / Comment-on / Transition / Update-fields**

In each of the 5 ticket phase files, find the line:

```ts
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
```

Replace with:

```ts
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
```

- [ ] **Step 2: Git/PR — clone, comment, get-repo, list-prs, open-pr, list-pr-comments**

In each of the 6 git phase files, find:

```ts
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
```

Replace with the same `slots: [...]` block as Step 1 (identical description).

- [ ] **Step 3: Repos — commit-and-push, start-feature-branch**

In each of the 2 files, find:

```ts
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
```

Replace with:

```ts
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT used by `git push` / `git fetch` against origin.",
    },
  ],
```

- [ ] **Step 4: AI — analyze-repo, plan-implementation, implement-changes**

In each of the 3 files, find:

```ts
  optionalSecrets: ["ANTHROPIC_API_KEY"],
```

Replace with:

```ts
  slots: [
    {
      name: "ANTHROPIC_API_KEY",
      description: "Anthropic API key. Optional — falls back to the SDK's ambient credentials when unset.",
      optional: true,
    },
  ],
```

- [ ] **Step 5: Notifications — send-message**

In `packages/phases/src/notifications/send-message.tsx`, find:

```ts
  defaultRequiredSecrets: ["SLACK_BOT_TOKEN"],
```

Replace with:

```ts
  slots: [
    {
      name: "SLACK_BOT_TOKEN",
      description: "Slack bot token (xoxb-...) used to post messages.",
    },
  ],
```

- [ ] **Step 6: Repos with no creds — create-workspace, cleanup-workspace, list-workspace-files**

These three already have `tabs.credentials: "hidden"` and no `defaultRequiredSecrets`. Leave them alone — they have no slots and the new resolver/UI both treat empty-slots as "no secrets needed."

---

## Task 6: Editor — palette drop seeds bindings

**Files:**
- Modify: `packages/flow-editor/src/canvas/Canvas.tsx`

- [ ] **Step 1: Replace the `requiredSecrets` seeding with `secretBindings`**

In `packages/flow-editor/src/canvas/Canvas.tsx`, find the block that creates a new node from a phase definition (around line 235-240):

```ts
      newNode = def
        ? {
            ...base,
            config: { ...(def.defaultConfig as Record<string, unknown>) },
            executorConfig: (() => {
              const provider = defaultProviderFor(def.executor.kind);
              return provider ? { provider } : undefined;
            })(),
            requiredSecrets: def.defaultRequiredSecrets?.length
              ? [...def.defaultRequiredSecrets]
              : undefined,
          }
        : base;
```

Replace with:

```ts
      newNode = def
        ? {
            ...base,
            config: { ...(def.defaultConfig as Record<string, unknown>) },
            executorConfig: (() => {
              const provider = defaultProviderFor(def.executor.kind);
              return provider ? { provider } : undefined;
            })(),
            secretBindings: (def.slots ?? []).reduce<Record<string, { mode: "auto" }>>(
              (acc, slot) => { acc[slot.name] = { mode: "auto" }; return acc; },
              {},
            ),
          }
        : base;
```

If `def.slots` is empty, the resulting `secretBindings` is an empty object — that's fine; it tells the resolver "nothing to resolve" and the editor "no slot rows to render."

---

## Task 7: Editor — RequiredSecretsTab full rebuild

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` with:

```tsx
// packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx
import { useEffect, useState, useMemo } from "react";
import type { FlowGraph, FlowNode, SecretBinding, SecretScope } from "@journeyman/core";
import { fetchVisibleSecrets, type VisibleSecret } from "../api/secrets.ts";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";
import type { SecretSlotDef } from "../phase-definition.ts";

export interface RequiredSecretsTabProps {
  flow: FlowGraph;
  node: FlowNode;
  orgId: string;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

const SCOPE_LABEL: Record<SecretScope, string> = {
  user: "Your secrets",
  org: "Organization",
  global: "Global",
};
const SCOPE_ORDER: SecretScope[] = ["user", "org", "global"];

function getBinding(node: FlowNode, slotName: string): SecretBinding {
  return node.secretBindings?.[slotName] ?? { mode: "auto" };
}
function setBinding(node: FlowNode, slotName: string, binding: SecretBinding): FlowNode {
  return {
    ...node,
    secretBindings: { ...(node.secretBindings ?? {}), [slotName]: binding },
  };
}

function bindingKey(b: SecretBinding): string {
  return b.mode === "auto" ? "auto" : `pinned:${b.scope}:${b.name}`;
}
function parseBindingKey(key: string): SecretBinding | null {
  if (key === "auto") return { mode: "auto" };
  const m = /^pinned:(user|org|global):(.+)$/.exec(key);
  if (!m) return null;
  return { mode: "pinned", scope: m[1] as SecretScope, name: m[2] };
}

function autoResolveTier(
  slotName: string,
  visible: VisibleSecret[],
): SecretScope | null {
  for (const scope of SCOPE_ORDER) {
    if (visible.some(v => v.scope === scope && v.name === slotName)) return scope;
  }
  return null;
}

function pinnedExists(b: SecretBinding, visible: VisibleSecret[]): boolean {
  if (b.mode !== "pinned") return true;
  return visible.some(v => v.scope === b.scope && v.name === b.name);
}

function flowScope(flow: FlowGraph): "user" | "org" | "global" | null {
  // The flow-editor only ever knows the FlowGraph (definition) — not the wrapping
  // Flow record. The cross-scope check that needs the flow's storage scope is also
  // done server-side at save (computeSaveWarnings). Client-side warning is best-effort:
  // if the editor caller passes a flow.scope on the FlowGraph we read it; else null.
  const fs = (flow as unknown as { scope?: "user" | "org" | "global" }).scope;
  return fs ?? null;
}

export function RequiredSecretsTab({ flow, node, orgId, onChange, readOnly }: RequiredSecretsTabProps) {
  const registry = usePhaseRegistry();
  const phaseDef = node.phaseType ? registry.get(node.phaseType) : undefined;
  const slots: SecretSlotDef[] = phaseDef?.slots ?? [];

  const [visible, setVisible] = useState<VisibleSecret[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVisibleSecrets(orgId).then(r => {
      if (!cancelled) { setVisible(r.scoped); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const grouped = useMemo(() => {
    const out: Record<SecretScope, string[]> = { user: [], org: [], global: [] };
    for (const v of visible) {
      if (!out[v.scope].includes(v.name)) out[v.scope].push(v.name);
    }
    for (const s of SCOPE_ORDER) out[s].sort();
    return out;
  }, [visible]);

  const fScope = flowScope(flow);

  if (slots.length === 0) {
    return (
      <div className="je-props__field">
        <div style={{ color: "#888", fontSize: 11, fontStyle: "italic" }}>
          This phase doesn't need any secrets.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="je-props__field" style={{ marginBottom: 12 }}>
        <button
          onClick={() => setHelpOpen(o => !o)}
          style={{
            background: "transparent", border: "1px solid #2a3148", color: "#7da7ff",
            padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
          }}
        >{helpOpen ? "▾" : "▸"} How secrets are resolved</button>
        {helpOpen && (
          <div style={{
            marginTop: 6, padding: "8px 10px", background: "#161a26",
            border: "1px solid #2a3148", borderRadius: 4, fontSize: 11, color: "#bbb",
            lineHeight: 1.5,
          }}>
            Each row below is something this step needs at run time.<br />
            <b style={{ color: "#7da7ff" }}>Auto</b> — system finds a secret with the
            exact same name. Looks in <i>your secrets first</i>, then <i>organization</i>,
            then <i>global</i>. First match wins.<br />
            <b style={{ color: "#7da7ff" }}>Pin</b> — pick one specific secret from any
            tier. That exact one is used; no fallback.<br />
            Names are exact and case-sensitive. <code>GITHUB_TOKEN</code> won't match
            <code>MY_GITHUB_TOKEN</code>.
          </div>
        )}
      </div>

      {slots.map(slot => {
        const binding = getBinding(node, slot.name);
        return (
          <SlotRow
            key={slot.name}
            slot={slot}
            binding={binding}
            visible={visible}
            grouped={grouped}
            loaded={loaded}
            flowScope={fScope}
            readOnly={readOnly}
            onChange={(next) => onChange(setBinding(node, slot.name, next))}
          />
        );
      })}
    </div>
  );
}

interface SlotRowProps {
  slot: SecretSlotDef;
  binding: SecretBinding;
  visible: VisibleSecret[];
  grouped: Record<SecretScope, string[]>;
  loaded: boolean;
  flowScope: "user" | "org" | "global" | null;
  readOnly?: boolean;
  onChange: (next: SecretBinding) => void;
}

function SlotRow({ slot, binding, visible, grouped, loaded, flowScope, readOnly, onChange }: SlotRowProps) {
  const autoTier = useMemo(() => autoResolveTier(slot.name, visible), [slot.name, visible]);
  const exists = pinnedExists(binding, visible);

  const onSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = parseBindingKey(e.target.value);
    if (next) onChange(next);
  };

  // Cross-scope warning (best-effort, also enforced server-side).
  const crossScope =
    binding.mode === "pinned" &&
    flowScope !== null &&
    isNarrower(binding.scope, flowScope);

  return (
    <div className="je-props__field" style={{
      borderTop: "1px solid #2a2a3a", paddingTop: 10, marginTop: 10,
    }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#ddd" }}>
          {slot.name}
        </code>
        {slot.optional && (
          <span style={{ fontSize: 10, color: "#888" }}>(optional)</span>
        )}
      </label>
      <div style={{ fontSize: 10, color: "#888", marginTop: 2, marginBottom: 6 }}>
        {slot.description}
      </div>

      <select
        value={bindingKey(binding)}
        onChange={onSelect}
        disabled={readOnly}
        style={{
          width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 11,
          background: "#1f1f2c", border: "1px solid #444", color: "#ddd",
          padding: "4px 6px", borderRadius: 4,
        }}
      >
        <option value="auto">Auto (Your secrets &gt; Organization &gt; Global)</option>
        {SCOPE_ORDER.map(scope => {
          const names = grouped[scope];
          if (names.length === 0) return null;
          return (
            <optgroup key={scope} label={SCOPE_LABEL[scope]}>
              {names.map(n => (
                <option key={`${scope}:${n}`} value={`pinned:${scope}:${n}`}>{n}</option>
              ))}
            </optgroup>
          );
        })}
      </select>

      <Preview
        slot={slot}
        binding={binding}
        autoTier={autoTier}
        exists={exists}
        loaded={loaded}
      />

      {crossScope && (
        <div style={{
          marginTop: 6, fontSize: 11, color: "#f0c97a",
          padding: "4px 8px", background: "#3a2e1a",
          border: "1px solid #c08a3e", borderRadius: 4,
        }}>
          ⚠ This is a {flowScope}-scope flow but you pinned a {(binding as { scope: SecretScope }).scope}-scope secret.
          Other runners won't see it.
        </div>
      )}
    </div>
  );
}

function isNarrower(pinned: SecretScope, flow: "user" | "org" | "global"): boolean {
  // user is narrower than org and global; org is narrower than global.
  if (flow === "user") return false;
  if (flow === "org") return pinned === "user";
  /* global */ return pinned === "user" || pinned === "org";
}

interface PreviewProps {
  slot: SecretSlotDef;
  binding: SecretBinding;
  autoTier: SecretScope | null;
  exists: boolean;
  loaded: boolean;
}

function Preview({ slot, binding, autoTier, exists, loaded }: PreviewProps) {
  if (!loaded) return null;
  const style = (color: string) => ({
    marginTop: 4, fontSize: 11, color,
  });
  if (binding.mode === "auto") {
    if (autoTier) {
      return <div style={style("#7fc480")}>✓ Will use: {slot.name} from {SCOPE_LABEL[autoTier]}</div>;
    }
    if (slot.optional) {
      return <div style={style("#9aaab9")}>ℹ Optional. None found — phase will use its own default.</div>;
    }
    return <div style={style("#f0c97a")}>⚠ No secret named {slot.name} in any tier. Run will fail.</div>;
  }
  // pinned
  if (!exists) {
    return <div style={style("#f0c97a")}>⚠ Pinned secret {binding.name} ({SCOPE_LABEL[binding.scope]}) is not accessible. Runs will fail.</div>;
  }
  return <div style={style("#9aaab9")}>ℹ Pinned to {binding.name} ({SCOPE_LABEL[binding.scope]}). No fallback.</div>;
}
```

---

## Task 8: Editor — PropertiesPanel wiring update

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Update `requiredEmpty` and pass `flow` to RequiredSecretsTab**

Find the `requiredEmpty` block and replace `requiredSecrets: !(node.requiredSecrets?.length)` with the slot-bindings check:

```tsx
  const requiredEmpty = {
    io: !((node as { inputs?: unknown[] }).inputs?.length || (node as { outputs?: unknown[] }).outputs?.length),
    credentials: !(node as { credentials?: unknown }).credentials,
    requiredSecrets: !(node.secretBindings && Object.keys(node.secretBindings).length),
    mcp: !((node as { mcpTools?: unknown[] }).mcpTools?.length),
    retry: !node.retry,
  };
```

Then find the JSX line:

```tsx
          {effectiveActive === "requiredSecrets" && <RequiredSecretsTab node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
```

Replace with:

```tsx
          {effectiveActive === "requiredSecrets" && <RequiredSecretsTab flow={flow} node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} />}
```

---

## Task 9: Editor — Topbar renders new warning shape

**Files:**
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Render `cross_scope_pin` warnings**

Find the existing `SecretWarningsSection` function. Replace it with a discriminated-union renderer that handles both warning codes:

```tsx
function SecretWarningsSection({ warnings }: { warnings: FlowSaveWarning[] }) {
  return (
    <div className="je-validate-section je-validate-section--warn">
      <div className="je-validate-section__title">Secret warnings ({warnings.length})</div>
      {warnings.map((w, i) => {
        if (w.code === "inaccessible_secrets") {
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>{w.message}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {w.names.map(n => (
                  <code
                    key={n}
                    style={{
                      padding: "1px 6px",
                      border: "1px solid #c08a3e",
                      color: "#f0c97a",
                      borderRadius: 3,
                      fontSize: 11,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >{n}</code>
                ))}
              </div>
            </div>
          );
        }
        // code === "cross_scope_pin"
        return (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ marginBottom: 4 }}>{w.message}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "#bbb" }}>
              {w.entries.map((e, j) => (
                <li key={j}>
                  <code>{e.slot}</code> on node <code>{e.nodeId}</code> pinned to{" "}
                  <b>{e.pinnedScope}</b> in a <b>{e.flowScope}</b>-scope flow
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
```

The wrapping `<ValidationPanel>` already routes `secretWarnings` into this component — no changes needed there.

---

## Task 10: Web — extend FlowValidationReport for new code

**Files:**
- Modify: `packages/web/src/api/flows.ts`

- [ ] **Step 1: Confirm `FlowSaveWarning` import already covers both codes**

In `packages/web/src/api/flows.ts`, the existing `secretWarnings: FlowSaveWarning[]` field is already typed against the core union — no change needed since Task 1 extended the union upstream. Just verify by re-reading the file; nothing to write here.

---

## Task 11: Save-time validation — bindings + cross-scope

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Rewrite `computeSaveWarnings` to walk bindings**

Replace the existing `computeSaveWarnings` function (currently iterating `node.requiredSecrets`) with:

```ts
import { listVisibleSecrets } from "@journeyman/secrets";
import type { FlowSaveWarning, SecretBinding, SecretScope, FlowScope } from "@journeyman/core";

async function computeSaveWarnings(
  c: Composition,
  ctx: NonNullable<import("fastify").FastifyRequest["runContext"]>,
  flowScope: FlowScope,
  definition: FlowGraph,
): Promise<FlowSaveWarning[]> {
  if (!c.pool) return [];
  const visible = await listVisibleSecrets(c.pool, ctx);
  const visibleByScopeName = new Set(visible.map(v => `${v.scope}:${v.name}`));
  const visibleNames = new Set(visible.map(v => v.name));

  const inaccessible = new Set<string>();
  const crossScope: Array<{ nodeId: string; slot: string; pinnedScope: SecretScope; flowScope: FlowScope }> = [];

  for (const node of definition.nodes) {
    const bindings = (node.secretBindings ?? {}) as Record<string, SecretBinding>;
    for (const [slotName, binding] of Object.entries(bindings)) {
      if (binding.mode === "auto") {
        if (!visibleNames.has(slotName)) inaccessible.add(slotName);
        continue;
      }
      // mode "pinned"
      if (!visibleByScopeName.has(`${binding.scope}:${binding.name}`)) {
        inaccessible.add(binding.name);
      }
      if (isNarrowerScope(binding.scope, flowScope)) {
        crossScope.push({ nodeId: node.id, slot: slotName, pinnedScope: binding.scope, flowScope });
      }
    }
  }

  const warnings: FlowSaveWarning[] = [];
  if (inaccessible.size > 0) {
    warnings.push({
      code: "inaccessible_secrets",
      message: "Flow references secrets you cannot currently access. Runs will fail until they are created.",
      names: [...inaccessible].sort(),
    });
  }
  if (crossScope.length > 0) {
    warnings.push({
      code: "cross_scope_pin",
      message: "Some slots are pinned to a narrower scope than the flow itself. Other runners won't see them.",
      entries: crossScope,
    });
  }
  return warnings;
}

function isNarrowerScope(pinned: SecretScope, flow: FlowScope): boolean {
  if (flow === "user") return false;
  if (flow === "org") return pinned === "user";
  /* global */ return pinned === "user" || pinned === "org";
}
```

- [ ] **Step 2: Pass `flowScope` to every call**

Find the three sites that call `computeSaveWarnings(c, ctx, body.definition as FlowGraph)` (POST /flows, PUT /flows/:id, POST /flows/validate) and update each:

For `POST /flows`:
```ts
    const warnings = await computeSaveWarnings(c, ctx, body.scope as FlowScope, body.definition as FlowGraph);
```

For `PUT /flows/:id`:
```ts
      warnings = await computeSaveWarnings(c, ctx, flow.scope, body.definition as FlowGraph);
```

For `POST /flows/validate`:
```ts
    // Validate works against the user's caller scope — fall back to "user" since
    // no flow record exists yet at validate time.
    const callerScope: FlowScope = "user";
    const secretWarnings = await computeSaveWarnings(c, ctx, callerScope, body.definition);
```

- [ ] **Step 3: Update `FlowValidationReport` interface to keep `secretWarnings` field present**

The existing `FlowValidationReport` already has `secretWarnings: FlowSaveWarning[]`. The union got broader in Task 1 — TypeScript carries it through automatically. No code change in this step beyond confirming.

---

## Task 12: Update zod schema for new node shape

**Files:**
- Modify: `packages/api-server/src/schemas/update-flow.ts`

- [ ] **Step 1: Replace `requiredSecrets` field with `secretBindings`**

Find the `flowNodeSchema` block and replace the `requiredSecrets` line:

```ts
  requiredSecrets: z.array(z.string()).optional(),
```

With:

```ts
  secretBindings: z.record(
    z.string(),
    z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("auto") }),
      z.object({
        mode: z.literal("pinned"),
        scope: z.enum(["user", "org", "global"]),
        name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      }),
    ]),
  ).optional(),
```

The `.passthrough()` on `flowNodeSchema` means any leftover legacy `requiredSecrets` from older saves silently passes through, which is what we want for the read-side migration in Task 13. No need to reject explicitly.

---

## Task 13: Conductor converter — bindings → task input + legacy migration

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Add a top-level migration helper**

Near the top of `packages/orchestrator/src/flow-json/conductor-converter.ts` (just below imports), add:

```ts
import type { FlowNode, SecretBinding } from "@journeyman/core";

/**
 * Read-side migration: legacy nodes used `requiredSecrets: string[]` to declare
 * env-var names. Convert to all-`auto` bindings on read so we don't need a DB
 * migration. Newer flows already carry `secretBindings`.
 */
function migrateLegacyBindings(node: FlowNode): FlowNode {
  if (node.secretBindings) return node;
  const legacy = (node as unknown as { requiredSecrets?: string[] }).requiredSecrets;
  if (!legacy || legacy.length === 0) return node;
  const secretBindings: Record<string, SecretBinding> = {};
  for (const name of legacy) secretBindings[name] = { mode: "auto" };
  return { ...node, secretBindings };
}
```

- [ ] **Step 2: Apply migration at converter entry**

Find the converter's main entry point (the function that walks `definition.nodes`). It will be in either `validateGraph` or the `emitPhase`/`buildSequence` path. Find the first place `definition.nodes` is iterated and wrap it:

In the `convert(...)` or equivalent top-level method, just after the input definition is captured, normalize:

```ts
  const normalizedDefinition: FlowGraph = {
    ...definition,
    nodes: definition.nodes.map(migrateLegacyBindings),
  };
```

Use `normalizedDefinition` everywhere `definition` is currently passed downstream within the converter.

- [ ] **Step 3: Replace `requiredSecrets` emission with `secretBindings`**

In `emitPhase`, find the existing block that builds the `credentials` map (lines ~157-167):

```ts
      inputParameters: (() => {
        const creds: Record<string, string> = {
          ...((node.config as { credentials?: Record<string, string> } | undefined)?.credentials ?? {}),
        };
        for (const name of node.requiredSecrets ?? []) {
          creds[name] = `env:${name}`;
        }
        return {
          ...(node.config ?? {}),
          ...resolveInputs(node.inputs),
          retry: node.retry ?? {},
          credentials: creds,
        };
      })(),
```

Replace with:

```ts
      inputParameters: (() => {
        const creds: Record<string, string> = {
          ...((node.config as { credentials?: Record<string, string> } | undefined)?.credentials ?? {}),
        };
        // Bindings ride end-to-end as a structured field; the worker resolves
        // them via `resolveBindings` (not the legacy "env:NAME" indirection).
        const bindings = node.secretBindings ?? {};
        return {
          ...(node.config ?? {}),
          ...resolveInputs(node.inputs),
          retry: node.retry ?? {},
          credentials: creds,
          secretBindings: bindings,
        };
      })(),
```

The legacy `credentials` map stays in place untouched (still used by the existing `EnvCredentialStore` for any explicit `env:NAME` overrides set on the node config). The new `secretBindings` field is what the new resolver consumes.

---

## Task 14: Worker harness — resolveBindings + slot-keyed env

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Switch resolution to `resolveBindings`**

In `packages/orchestrator/src/workers/worker-harness.ts`, find the existing block that calls `this.deps.credentials.resolve(...)` (around lines 84-105). Replace the entire `try { resolvedEnv = ... } catch {...}` block with:

```ts
    const flowId = ((task.inputData ?? {}) as { flowId?: string | null }).flowId ?? null;
    const declaredBindings =
      ((task.inputData ?? {}) as { secretBindings?: Record<string, import("@journeyman/core").SecretBinding> })
        .secretBindings ?? {};

    let resolvedEnv: Record<string, string>;
    try {
      const phaseDef = this.deps.registry.get(phaseType);
      const slots = (phaseDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];

      // Reuse the existing credential-store path when no slots are declared
      // (legacy phases or those with no creds). Slot-aware resolution kicks in
      // when the registered phase has slots OR the task has bindings.
      if (slots.length === 0 && Object.keys(declaredBindings).length === 0) {
        const declaredCreds =
          ((task.inputData ?? {}) as { credentials?: Record<string, string> }).credentials ?? {};
        resolvedEnv = await this.deps.credentials.resolve(declaredCreds, { userId, flowId });
      } else {
        resolvedEnv = await this.deps.bindingResolver({
          ctx: { userId, flowId },
          slots,
          bindings: declaredBindings,
        });
      }
    } catch (err: any) {
      const isCredErr =
        err?.name === "CredentialNotFoundError" || err?.name === "MissingSecretsError";
      if (isCredErr) {
        const missing: string[] = err.missing ?? (err.ref ? [String(err.ref)] : []);
        await this.deps.events.append({
          runId, nodeId, eventType: "phase.failed",
          payload: { reason: "missing_secrets", missing, message: String(err?.message ?? "") },
        });
        await this.deps.client.completeTask({
          workflowInstanceId: runId, taskId: task.taskId,
          status: "FAILED_WITH_TERMINAL_ERROR",
          reasonForIncompletion: `missing_secrets: ${missing.join(", ") || err?.message || "unknown"}`,
        });
        return;
      }
      throw err;
    }
```

Note: the harness now reads phase metadata via `this.deps.registry.get(phaseType)`. The `IPhaseRegistry` interface already exposes `get(phaseType)` — confirm by inspection. If the returned object doesn't carry `slots`, the cast above degrades to `slots = []` and the legacy path is used (safe fallback).

- [ ] **Step 2: Stop merging `process.env`**

Find the block that builds the handler `env`:

```ts
        env: { ...(process.env as Record<string, string>), ...resolvedEnv },
```

Replace with:

```ts
        env: resolvedEnv,
```

- [ ] **Step 3: Add `bindingResolver` to `WorkerHarnessDeps`**

Find the `WorkerHarnessDeps` interface at the top of the file and add the new field:

```ts
import type { SecretBinding } from "@journeyman/core";

export interface WorkerHarnessDeps {
  client: ConductorClient;
  registry: IPhaseRegistry;
  workspace: IWorkspaceProvider;
  credentials: ICredentialStore;
  events: IEventBus;
  workerId: string;
  pollIntervalMs?: number;

  /**
   * Slot-aware resolver injected by the composition root. The harness uses
   * this when the phase declares slots (or the task carries bindings);
   * otherwise it falls back to `credentials.resolve`.
   */
  bindingResolver: (input: {
    ctx: { userId: string | null; flowId: string | null };
    slots: Array<{ name: string; optional?: boolean }>;
    bindings: Record<string, SecretBinding>;
  }) => Promise<Record<string, string>>;
}
```

---

## Task 15: api-server composition — wire bindingResolver

**Files:**
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Build the resolver closure and pass to harness**

Find the section of `composition.ts` that constructs the worker harness (look for `new WorkerHarness(`). Just above it, build the closure:

```ts
import { resolveBindings } from "@journeyman/secrets";

// ...inside the composition factory, after `pool` is set up:
const bindingResolver = async (input: {
  ctx: { userId: string | null; flowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, import("@journeyman/core").SecretBinding>;
}): Promise<Record<string, string>> => {
  if (!pool || !input.ctx.userId) return {};
  const u = await getUser(pool, input.ctx.userId);
  if (!u) return {};
  const memQ = await pool.query(
    "SELECT id, org_id, role FROM jm_memberships WHERE user_id = $1 ORDER BY created_at LIMIT 1",
    [input.ctx.userId],
  );
  const m = memQ.rows[0]; if (!m) return {};
  const o = await getOrg(pool, m.org_id); if (!o) return {};
  const runCtx = {
    user: { id: u.id, username: u.username },
    org: { id: o.id, slug: o.slug },
    membershipId: m.id,
    role: m.role,
    isPlatformAdmin: u.isPlatformAdmin,
    tokenKind: "access-jwt" as const,
  };
  const r = await resolveBindings({
    pool, ctx: runCtx, slots: input.slots, bindings: input.bindings,
  });
  return r.values;
};
```

Then in the `new WorkerHarness({...})` call, add `bindingResolver` to the deps object. The existing harness construction stays otherwise unchanged.

(If there's already a `getRunContext` closure on the file used by `SecretsCredentialStore`, factor it out and reuse — both closures derive a `RunContext` from the same userId.)

---

## Task 16: cli-worker — error on pinned bindings

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Pass a binding resolver that handles auto-only**

Find the existing `new WorkerHarness({` block in `cli-worker.ts`. The current `credentials: new EnvCredentialStore()` line stays (legacy fallback). Add a `bindingResolver` that fails fast on pinned bindings and resolves auto-mode against `process.env` (global tier only, since the CLI worker has no run context):

```ts
import type { SecretBinding } from "@journeyman/core";

const cliBindingResolver = async (input: {
  ctx: { userId: string | null; flowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const slot of input.slots) {
    const b = input.bindings[slot.name] ?? { mode: "auto" as const };
    if (b.mode === "pinned") {
      throw new Error(
        `cli-worker cannot resolve pinned binding for slot "${slot.name}" — ` +
        `pinned scopes (user/org) require a database. Run via api-server.`,
      );
    }
    const v = process.env[`JM_GLOBAL_${slot.name}`] ?? process.env[slot.name];
    if (v != null) { out[slot.name] = v; continue; }
    if (!slot.optional) missing.push(slot.name);
  }
  if (missing.length > 0) {
    const err = new Error(`Missing required secrets: ${missing.join(", ")}`) as Error & { name: string; missing: string[] };
    err.name = "MissingSecretsError";
    err.missing = missing;
    throw err;
  }
  return out;
};
```

In the `new WorkerHarness({` constructor call, add `bindingResolver: cliBindingResolver` to the deps object.

---

## Task 17: Provider plumbing — token-only constructors

**Files:**
- Modify: `packages/git-provider/src/providers/github/index.ts`
- Modify: `packages/ticket-provider/src/providers/github-issues/index.ts`
- Modify: `packages/ticket-provider/src/providers/github-projects/index.ts`
- Modify: `packages/ticket-provider/src/providers/jira/index.ts` (and any token-reading utility under `packages/ticket-provider/src/providers/jira/utils/mcp-config.ts`)
- Modify: `packages/coding-cli/src/providers/claude/index.ts`

- [ ] **Step 1: GitHubProvider (git-provider) — require token via opts**

In `packages/git-provider/src/providers/github/index.ts`, find the existing token-resolution chain (around line 38-42):

```ts
    const token =
      opts.token
      ?? (opts.tokenEnv ? process.env[opts.tokenEnv] : undefined)
      ?? process.env.GITHUB_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        "GitHubProvider: PAT required. Pass opts.token, set opts.tokenEnv to a populated env var, or set GITHUB_ACCESS_TOKEN.",
      );
    }
```

Replace with:

```ts
    const token = opts.token;
    if (!token) {
      throw new Error("GitHubProvider: opts.token is required.");
    }
```

Remove `tokenEnv` from the opts type if it's only used here, or leave the type field but stop reading it. Delete any now-unused `process.env` reads.

- [ ] **Step 2: GitHubIssuesProvider (ticket-provider) — same change**

Same pattern in `packages/ticket-provider/src/providers/github-issues/index.ts` (lines ~76-82). Reduce to `const token = this.opts.token; if (!token) throw ...`.

- [ ] **Step 3: GitHubProjectsProvider — same change**

Same pattern in `packages/ticket-provider/src/providers/github-projects/index.ts`.

- [ ] **Step 4: Jira provider — accept token via opts, drop env reads**

In `packages/ticket-provider/src/providers/jira/index.ts` and the helper `utils/mcp-config.ts`, locate any reads of `process.env.JIRA_API_TOKEN` / `process.env.JIRA_EMAIL` etc. Replace with values from a constructor `opts` object: `opts.apiToken`, `opts.email`, `opts.host`. If the values aren't supplied, throw a clear error: `"JiraProvider: opts.{field} is required."`.

- [ ] **Step 5: Claude coding-cli provider — accept apiKey via opts**

In `packages/coding-cli/src/providers/claude/index.ts`, add `apiKey?: string` to the constructor opts. Where the SDK is invoked, pass through:

```ts
// inside the call site that constructs the SDK query options
const sdkOptions = {
  // ...existing options...
  ...(this.opts.apiKey ? { apiKey: this.opts.apiKey } : {}),
};
```

Concrete: scan for `query(` calls in the operations under `packages/coding-cli/src/providers/claude/operations/*.ts`. Each one accepts an `Options` object — pass `apiKey` through if the constructor received one. The SDK uses `process.env.ANTHROPIC_API_KEY` by default when `apiKey` is omitted, which preserves the "optional" semantics.

If the SDK's `Options` shape doesn't accept `apiKey` directly, the equivalent is set via `process.env.ANTHROPIC_API_KEY` for the duration of the call. To avoid mutating global env, wrap each SDK call in a local override:

```ts
const prev = process.env.ANTHROPIC_API_KEY;
if (this.opts.apiKey) process.env.ANTHROPIC_API_KEY = this.opts.apiKey;
try {
  // ...existing query() call...
} finally {
  if (this.opts.apiKey) {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    else delete process.env.ANTHROPIC_API_KEY;
  }
}
```

This is the only `process.env` mutation we accept; it's scoped to a single SDK call and always reverted.

---

## Task 18: Phase handlers — build provider per call from ctx.env

**Files (all modified):**
- `packages/orchestrator/src/workers/phases/get-ticket-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/create-ticket-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/add-ticket-comment-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/update-status-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/update-ticket-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/clone-repos-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/checkout-repo-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/commit-push-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/create-pr-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/list-prs-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/get-repo-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/fetch-pr-comments-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/scan-repos-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/cleanup-repos-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/create-workspace-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/notify-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/analyze-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/plan-phase-handler.ts`
- `packages/orchestrator/src/workers/phases/implement-phase-handler.ts`

- [ ] **Step 1: Replace ProviderResolver dep with provider factory**

For every handler in the list above, follow this pattern. The current shape is:

```ts
constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
  const ticket = this.deps.ticket.resolve(typeof input.provider === "string" ? input.provider : undefined);
  // ...uses ticket...
}
```

Change the dependency type to a factory that takes the per-call env, and call it inside `run()`:

```ts
constructor(private deps: {
  ticketFactory: (key: string | undefined, env: Record<string, string>) => ITicketProvider;
}) {}

async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
  const ticket = this.deps.ticketFactory(
    typeof input.provider === "string" ? input.provider : undefined,
    ctx.env,
  );
  // ...uses ticket...
}
```

Apply the same shape to:
- `git-provider`-based handlers → `gitFactory(key, env) → IGitProvider`
- `coding-cli`-based handlers → `codingFactory(key, env) → ICodingCLI`
- `notification`-based handlers (`notify-phase-handler`) → `notificationFactory(key, env) → INotificationProvider`

Handlers that don't use providers (cleanup-workspace, list-workspace-files, create-workspace if it's local-only — verify) need no change.

- [ ] **Step 2: Composition wires factories**

In `packages/api-server/src/composition.ts` and `packages/orchestrator/src/cli-worker.ts`, replace the existing `ProviderResolver` instances with factories:

```ts
// composition.ts (server) and cli-worker.ts — same shape
const ticketFactory = (key: string | undefined, env: Record<string, string>): ITicketProvider => {
  switch (key ?? "github-issues") {
    case "github-issues":
      return new GitHubIssuesProvider({ token: env.GITHUB_ACCESS_TOKEN });
    case "github-projects":
      return new GitHubProjectsProvider({ token: env.GITHUB_ACCESS_TOKEN });
    case "jira":
      return new JiraProvider({
        apiToken: env.JIRA_API_TOKEN,
        email: env.JIRA_EMAIL,
        host: env.JIRA_HOST,
      });
    default:
      throw new Error(`Unknown ticket provider: ${key}`);
  }
};

const gitFactory = (key: string | undefined, env: Record<string, string>): IGitProvider => {
  switch (key ?? "github") {
    case "github":
      return new GitHubProvider({ token: env.GITHUB_ACCESS_TOKEN });
    default:
      throw new Error(`Unknown git provider: ${key}`);
  }
};

const codingFactory = (key: string | undefined, env: Record<string, string>): ICodingCLI => {
  switch (key ?? "claude") {
    case "claude":
      return new ClaudeProvider({ apiKey: env.ANTHROPIC_API_KEY });
    case "gemini":
      return new GeminiProvider({});
    case "codex":
      return new CodexProvider({});
    default:
      throw new Error(`Unknown coding provider: ${key}`);
  }
};

const notificationFactory = (key: string | undefined, env: Record<string, string>): INotificationProvider => {
  switch (key ?? "slack") {
    case "slack":
      return new SlackProvider({ token: env.SLACK_BOT_TOKEN });
    default:
      throw new Error(`Unknown notification provider: ${key}`);
  }
};
```

Pass these into the handler constructors instead of the existing `MapProviderResolver` instances.

The old `MapProviderResolver` may still be used by code outside this plan; leave the class alone, just stop wiring it into the new handler shape.

---

## Task 19: Final typecheck

**Files:**
- All packages.

- [ ] **Step 1: Typecheck the entire monorepo**

Run:

```bash
npm run typecheck
```

Expected output: zero errors. If any package has type errors, fix them by re-reading the relevant task in this plan to confirm the contract is consistent (e.g. `SecretBinding` import path, `slots` field on PhaseDefinition, factory signatures). Re-run until clean.

---

## Self-review

**Spec coverage:**

- §1 Goal — Tasks 1–19 collectively.
- §3 Mental model — Tasks 1, 3, 14 (resolver, harness, bindings).
- §5.1 SecretSlotDef — Task 4.
- §5.2 SecretBinding — Task 1.
- §5.3 Persistence (no migration) — Task 12 (zod) + Task 13 (read-side migration shim).
- §5.4 Migration of legacy flows — Task 13 step 1.
- §6 Resolver — Tasks 2, 3.
- §7 Runtime gap — Tasks 14, 17, 18.
- §7.3 CLI worker — Task 16.
- §8 Editor UX — Tasks 6, 7, 8, 9, 10.
- §8.4 Resolution preview — Task 7 (`Preview` component).
- §8.5 Cross-scope warnings — Task 7 (client-side) + Task 11 (server-side).
- §9.1 Visible names endpoint — already built; no task needed.
- §9.3 Save-time validation — Task 11.
- §10 Failure modes — covered by Tasks 3, 11, 14, 16.
- §11 Rollout — every step has a task in the corresponding order.

**Type consistency:**

- `SecretSlotDef` defined in Task 4, imported in Task 7, referenced in Task 14 step 1 and Task 16.
- `SecretBinding` defined in Task 1, imported in Tasks 3, 7, 11, 13, 14, 16.
- `resolveBindings` signature defined in Task 3, called in Task 15 (composition), and shape mirrored by `cliBindingResolver` in Task 16.
- `slots` on PhaseDefinition (Task 4) is the only source of truth for the editor (Task 7) and the harness (Task 14 step 1).
- Factory signatures in Task 18 step 2 match the deps shape introduced in Task 18 step 1.
- `FlowSaveWarning` extended in Task 1, consumed by Task 11 and rendered by Task 9; `FlowValidationReport` (Task 10) inherits the wider union automatically.

**Placeholder scan:** none — every task has concrete code or concrete reference points.

**Open implementation choices flagged in notes (not blockers):**

- Task 14 reads phase metadata via `IPhaseRegistry.get`. If the registered shape doesn't expose `slots` (e.g. the orchestrator uses a thinner registry than the editor), the cast degrades to `slots = []` and the legacy credential-store path runs — preserves correctness for any phase not yet migrated.
- Task 17 step 5 includes a `process.env.ANTHROPIC_API_KEY` override-and-restore around the SDK call as the fallback when the SDK's `Options` shape doesn't accept `apiKey` directly. Verify against `.claude/sdk.d.ts` during implementation; prefer the per-call option if it exists.
- Task 18 leaves `MapProviderResolver` untouched. If a follow-up wants to retire it entirely, that's a separate cleanup.
