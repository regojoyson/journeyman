# Custom Agents — Phase 1 (Agent Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the core of Custom Agents — a `@journeyman/agents` package (types, store, fire-time compiler), a self-contained `agent-run` step that clones repos and runs the agentic loop, manual "Run now" via API, and the agents UI (list + tabbed name-first/draft editor) with a draft→enable readiness gate and enabled=read-only.

**Architecture:** An agent is a first-class DB row (`jm_agents`). It is the source of truth; when run, a thin compiler builds an ephemeral single-step `WorkflowGraph` (`trigger-manual` → `agent-run` step → `end`) and submits it through the existing `IOrchestratorEngine.submit`. The `agent-run` step handler clones the agent's `repoSelections` via the existing clone helper, then calls `ICodingCLI.runCustomPrompt` with the agent's inline instructions/model/tools/maxSteps. Defers Connections, automated triggers (webhook/API/schedule), and Slack notifications to Phases 2–4.

**Tech Stack:** TypeScript (ESM, `.ts` extensions), Postgres via `pg`, Fastify (api-server), React + Tailwind (web), Vitest. Spec: `docs/superpowers/specs/2026-06-17-custom-agents-design.md`.

**Phase 1 simplifications (documented, not placeholders):**
- Repos are entered as **plain owner/repo or URL strings** (the existing `parseRepoList` format) — the Connections-backed repo picker is Phase 2. The agent stores `repos: string[]` + an optional `gitProvider` + `branch`; auth reuses the existing secret-binding/provider path the clone-repos step already uses.
- Notifications tab is a **shell** (stored but not delivered) — Slack delivery is Phase 4.
- Only the **manual** trigger fires in Phase 1. `AgentTrigger[]` is modeled now but webhook/API/schedule are Phases 2–3.

---

## File structure

**New files:**
- `packages/core/src/types/agent.types.ts` — Agent + sub-types (source of truth)
- `packages/migrations/src/sql/044_agents.sql` — `jm_agents` table
- `packages/agents/package.json`, `tsconfig.json`, `src/index.ts` — new package
- `packages/agents/src/db.ts` — agent store (CRUD)
- `packages/agents/src/db.test.ts`
- `packages/agents/src/compile.ts` — agent → WorkflowGraph
- `packages/agents/src/compile.test.ts`
- `packages/agents/src/readiness.ts` — enable readiness check
- `packages/agents/src/readiness.test.ts`
- `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`
- `packages/orchestrator/src/workers/steps/agent-run-step-handler.test.ts`
- `packages/api-server/src/routes/agents.ts` — CRUD + enable/disable + run-now
- `packages/web/src/api/agents.ts` — web API client
- `packages/web/src/routes/MyAgentsPage.tsx`, `AdminAgentsPage.tsx`
- `packages/web/src/components/agents/AgentsList.tsx`
- `packages/web/src/components/agents/EditAgentModal.tsx`

**Modified files:**
- `packages/core/src/index.ts` — export agent types
- `packages/orchestrator/src/cli-worker.ts` — register `AgentRunStepHandler`
- `packages/api-server/src/app.ts` (or wherever routes register) — mount agents routes
- `packages/web/src/App.tsx` — routes; `packages/web/src/components/Sidebar.tsx` — nav

---

# PART A — Backend core (create + run an agent via API)

## Task 1: Agent core types

**Files:**
- Create: `packages/core/src/types/agent.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the types file**

Create `packages/core/src/types/agent.types.ts`:

```typescript
import type { CanonicalTool } from "./coding-tools.types.ts";
import type { RetryPolicy } from "./flow.types.ts";
import type { CustomStepOutputField } from "./custom-steps.types.ts";

export type AgentScope = "user" | "org";
export type AgentStatus = "draft" | "active";

export interface AgentInputField {
  name: string;
  type: "text" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  description?: string;
}

/** Phase 1: a repo is a plain owner/repo or URL string + optional branch (Connections come in Phase 2). */
export interface AgentRepoSelection {
  repo: string;            // "owner/name" or clone URL
  branch?: string;
  allowWrites: boolean;    // false → claude/* branches only (enforced in later phases)
}

export interface AgentPermissions {
  allowedTools: CanonicalTool[];
}

export interface AgentNotifications {
  on: Array<"success" | "failure">;
  // Phase 1 shell: stored, not delivered. connectionId/target arrive in Phase 4.
}

export interface AgentBehavior {
  maxTurns?: number;
  timeoutSeconds?: number;
  retry?: RetryPolicy;
}

/** Phase 1 fires only "manual"; webhook/api/schedule modeled for later phases. */
export type AgentTrigger =
  | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> }
  | { type: "api"; tokenHash: string }
  | { type: "webhook"; webhookId: string; preset?: "jira" | "github"; event?: string; filters?: unknown; inputsMapping: Record<string, string> };

export interface Agent {
  id: string;
  scope: AgentScope;
  userId?: string;
  orgId: string;
  name: string;
  instructions: string;            // mustache template using {{input}} vars
  inputs: AgentInputField[];
  provider: string;                // "claude" | "opencode" | ...
  model?: string;
  connectorMcpIds: string[];
  tools: CanonicalTool[];
  skillIds: string[];
  repoSelections: AgentRepoSelection[];
  sandboxId?: string;
  permissions: AgentPermissions;
  notifications: AgentNotifications;
  outputMode: "none" | "text" | "structured";
  outputFields?: CustomStepOutputField[];
  behavior: AgentBehavior;
  triggers: AgentTrigger[];
  status: AgentStatus;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentCreateInput = Pick<Agent, "scope" | "name"> &
  Partial<Omit<Agent, "id" | "scope" | "name" | "orgId" | "userId" | "createdBy" | "createdAt" | "updatedAt">>;

export type AgentUpdateInput = Partial<Omit<Agent, "id" | "scope" | "orgId" | "userId" | "createdBy" | "createdAt" | "updatedAt">>;
```

- [ ] **Step 2: Export from core**

In `packages/core/src/index.ts`, add alongside the other `export * from "./types/..."` lines:

```typescript
export * from "./types/agent.types.ts";
```

- [ ] **Step 3: Typecheck**

Run: `npm --workspace @journeyman/core run typecheck`
Expected: PASS (no errors). If `CustomStepOutputField` import path differs, fix to match `custom-steps.types.ts`'s actual export.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/agent.types.ts packages/core/src/index.ts
git commit -m "feat(core): add Agent types for custom agents"
```

---

## Task 2: Migration — jm_agents table

**Files:**
- Create: `packages/migrations/src/sql/044_agents.sql`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/044_agents.sql`:

```sql
-- 044_agents.sql — custom agent definitions (scope: user/org).

CREATE TABLE IF NOT EXISTS jm_agents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  user_id     UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES jm_orgs(id)  ON DELETE CASCADE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
  enabled     BOOLEAN NOT NULL DEFAULT false,
  -- Full agent config (instructions, inputs, provider, model, tools, repos,
  -- permissions, notifications, behavior, triggers, outputMode/Fields) as one document.
  definition  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID NOT NULL REFERENCES jm_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_agents_scope_name_unique
    UNIQUE NULLS NOT DISTINCT (scope, user_id, org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_agents_org_user ON jm_agents (org_id, user_id);
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate`
Expected: output shows `044_agents.sql` applied, no errors.

- [ ] **Step 3: Verify the table exists**

Run: `psql "$DATABASE_URL" -c "\d jm_agents"` (or the project's psql alias)
Expected: table prints with columns `id, scope, user_id, org_id, name, status, enabled, definition, created_by, created_at, updated_at`.

- [ ] **Step 4: Commit**

```bash
git add packages/migrations/src/sql/044_agents.sql
git commit -m "feat(migrations): add jm_agents table"
```

---

## Task 3: @journeyman/agents package skeleton

**Files:**
- Create: `packages/agents/package.json`, `packages/agents/tsconfig.json`, `packages/agents/src/index.ts`

- [ ] **Step 1: package.json**

Create `packages/agents/package.json`:

```json
{
  "name": "@journeyman/agents",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@journeyman/core": "*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: tsconfig.json**

Create `packages/agents/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: index.ts (stub, expanded by later tasks)**

Create `packages/agents/src/index.ts`:

```typescript
export * from "./db.ts";
export * from "./compile.ts";
export * from "./readiness.ts";
```

- [ ] **Step 4: Install workspace link**

Run: `npm install`
Expected: completes; `@journeyman/agents` linked into the workspace. (index.ts will not typecheck until Tasks 4–6 create db/compile/readiness; that's expected.)

- [ ] **Step 5: Commit**

```bash
git add packages/agents/package.json packages/agents/tsconfig.json packages/agents/src/index.ts
git commit -m "feat(agents): scaffold @journeyman/agents package"
```

---

## Task 4: Agent store (db.ts)

**Files:**
- Create: `packages/agents/src/db.ts`
- Test: `packages/agents/src/db.test.ts`

The store keeps `name/status/enabled` as columns and everything else in the `definition` JSONB.

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/db.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { rowToAgent, buildInsert } from "./db.ts";

describe("rowToAgent", () => {
  it("merges columns with the definition JSONB", () => {
    const row = {
      id: "a1", scope: "org", user_id: null, org_id: "o1",
      name: "Triage", status: "draft", enabled: false,
      definition: { instructions: "do {{x}}", provider: "claude", tools: ["bash"], inputs: [], repoSelections: [], skillIds: [], connectorMcpIds: [], permissions: { allowedTools: [] }, notifications: { on: [] }, behavior: {}, triggers: [], outputMode: "text" },
      created_by: "u1", created_at: "2026-06-18T00:00:00Z", updated_at: "2026-06-18T00:00:00Z",
    };
    const a = rowToAgent(row);
    expect(a.id).toBe("a1");
    expect(a.name).toBe("Triage");
    expect(a.status).toBe("draft");
    expect(a.provider).toBe("claude");
    expect(a.tools).toEqual(["bash"]);
    expect(a.userId).toBeUndefined();
  });
});

describe("buildInsert", () => {
  it("splits name/status/enabled out of the definition", () => {
    const { cols, vals, def } = buildInsert({
      scope: "org", orgId: "o1", userId: null, createdBy: "u1",
      name: "Triage", status: "draft", enabled: false,
      instructions: "hi", provider: "claude", inputs: [], tools: [],
      connectorMcpIds: [], skillIds: [], repoSelections: [],
      permissions: { allowedTools: [] }, notifications: { on: [] },
      behavior: {}, triggers: [], outputMode: "text",
    } as any);
    expect(cols).toContain("name");
    expect(cols).toContain("definition");
    expect(vals).toContain("Triage");
    expect((def as any).instructions).toBe("hi");
    expect((def as any).name).toBeUndefined(); // name lives in its column, not the doc
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @journeyman/agents test -- db.test.ts`
Expected: FAIL — `rowToAgent`/`buildInsert` not exported.

- [ ] **Step 3: Write the store**

Create `packages/agents/src/db.ts`:

```typescript
import type { Pool } from "pg";
import type { Agent, AgentCreateInput, AgentUpdateInput } from "@journeyman/core";

export class DuplicateAgentError extends Error {
  constructor(name: string) { super(`agent "${name}" already exists`); this.name = "DuplicateAgentError"; }
}

const COLUMN_KEYS = new Set(["id", "scope", "userId", "orgId", "name", "status", "enabled", "createdBy", "createdAt", "updatedAt"]);

/** Everything that isn't a top-level column goes into the definition JSONB. */
function toDefinition(a: Record<string, unknown>): Record<string, unknown> {
  const def: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (!COLUMN_KEYS.has(k)) def[k] = v;
  return def;
}

export function rowToAgent(r: any): Agent {
  const d = r.definition ?? {};
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    name: r.name,
    status: r.status,
    enabled: r.enabled,
    instructions: d.instructions ?? "",
    inputs: d.inputs ?? [],
    provider: d.provider ?? "claude",
    model: d.model,
    connectorMcpIds: d.connectorMcpIds ?? [],
    tools: d.tools ?? [],
    skillIds: d.skillIds ?? [],
    repoSelections: d.repoSelections ?? [],
    sandboxId: d.sandboxId,
    permissions: d.permissions ?? { allowedTools: [] },
    notifications: d.notifications ?? { on: [] },
    outputMode: d.outputMode ?? "text",
    outputFields: d.outputFields,
    behavior: d.behavior ?? {},
    triggers: d.triggers ?? [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function buildInsert(
  input: AgentCreateInput & { orgId: string; userId: string | null; createdBy: string },
): { cols: string[]; vals: unknown[]; def: Record<string, unknown> } {
  const def = toDefinition(input as Record<string, unknown>);
  const cols = ["scope", "user_id", "org_id", "name", "status", "enabled", "definition", "created_by"];
  const vals = [
    input.scope, input.userId, input.orgId, input.name,
    (input as any).status ?? "draft", (input as any).enabled ?? false, def, input.createdBy,
  ];
  return { cols, vals, def };
}

export async function insertAgent(
  pool: Pool,
  input: AgentCreateInput & { orgId: string; userId: string | null; createdBy: string },
): Promise<Agent> {
  const { cols, vals } = buildInsert(input);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_agents (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rowToAgent(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateAgentError(input.name);
    throw err;
  }
}

export async function getAgent(pool: Pool, id: string): Promise<Agent | null> {
  const { rows } = await pool.query(`SELECT * FROM jm_agents WHERE id = $1`, [id]);
  return rows[0] ? rowToAgent(rows[0]) : null;
}

export async function listAgents(pool: Pool, orgId: string, userId: string | null): Promise<Agent[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_agents
     WHERE org_id = $1 AND COALESCE(user_id::text, '') = COALESCE($2::text, '')
     ORDER BY name ASC`,
    [orgId, userId],
  );
  return rows.map(rowToAgent);
}

export async function updateAgent(pool: Pool, id: string, patch: AgentUpdateInput): Promise<Agent | null> {
  const current = await getAgent(pool, id);
  if (!current) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if (patch.name !== undefined) push("name", patch.name);
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.enabled !== undefined) push("enabled", patch.enabled);

  // Merge any definition-level fields into the existing definition doc.
  const defPatch = toDefinition(patch as Record<string, unknown>);
  if (Object.keys(defPatch).length > 0) {
    const mergedDef = { ...toDefinition(current as unknown as Record<string, unknown>), ...defPatch };
    push("definition", mergedDef);
  }

  if (sets.length === 0) return current;
  sets.push(`updated_at = now()`);
  vals.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE jm_agents SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    return rows[0] ? rowToAgent(rows[0]) : null;
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateAgentError(patch.name ?? current.name);
    throw err;
  }
}

export async function deleteAgent(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM jm_agents WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @journeyman/agents test -- db.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/db.ts packages/agents/src/db.test.ts
git commit -m "feat(agents): agent store (CRUD over jm_agents)"
```

---

## Task 5: Fire-time compiler (compile.ts)

Compiles an `Agent` into a minimal `WorkflowGraph` and the run inputs.

**Files:**
- Create: `packages/agents/src/compile.ts`
- Test: `packages/agents/src/compile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/compile.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { compileAgentToGraph } from "./compile.ts";
import type { Agent } from "@journeyman/core";

const baseAgent: Agent = {
  id: "ag1", scope: "org", orgId: "o1", name: "Triage",
  instructions: "Fix {{ticketKey}}", inputs: [{ name: "ticketKey", type: "text", required: true }],
  provider: "claude", model: "claude-opus-4-8",
  connectorMcpIds: ["m1"], tools: ["bash", "read-file"], skillIds: ["s1"],
  repoSelections: [{ repo: "acme/api", branch: "main", allowWrites: false }],
  sandboxId: "sb1",
  permissions: { allowedTools: ["bash", "read-file"] },
  notifications: { on: ["failure"] },
  outputMode: "text",
  behavior: { maxTurns: 40, timeoutSeconds: 1800 },
  triggers: [], status: "active", enabled: true,
  createdBy: "u1", createdAt: "", updatedAt: "",
};

describe("compileAgentToGraph", () => {
  it("builds trigger → agent-run → end with agent config on the step node", () => {
    const { graph } = compileAgentToGraph(baseAgent);
    expect(graph.schemaVersion).toBe(2);
    const stepNode = graph.nodes.find((n) => n.stepType === "agent-run")!;
    expect(stepNode).toBeTruthy();
    expect(stepNode.config!.agentId).toBe("ag1");
    expect(stepNode.config!.instructions).toBe("Fix {{ticketKey}}");
    expect(stepNode.config!.repos).toEqual(["acme/api"]);
    expect(stepNode.config!.maxSteps).toBe(40);
    expect(stepNode.sandboxId).toBe("sb1");
    expect(stepNode.model).toBe("claude-opus-4-8");
    const trigger = graph.nodes.find((n) => n.type === "trigger-manual")!;
    expect(graph.edges.some((e) => e.source === trigger.id && e.target === stepNode.id)).toBe(true);
  });

  it("renders required inputs and rejects missing ones", () => {
    expect(() => compileAgentToGraph(baseAgent, {})).toThrow(/ticketKey/);
    const { inputs } = compileAgentToGraph(baseAgent, { ticketKey: "PROJ-1" });
    expect(inputs.ticketKey).toBe("PROJ-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @journeyman/agents test -- compile.test.ts`
Expected: FAIL — `compileAgentToGraph` not defined.

- [ ] **Step 3: Write the compiler**

Create `packages/agents/src/compile.ts`:

```typescript
import type { Agent, WorkflowGraph } from "@journeyman/core";

export class MissingRequiredInputError extends Error {
  constructor(name: string) { super(`missing required input: ${name}`); this.name = "MissingRequiredInputError"; }
}

/** Resolve the run inputs from supplied values + defaults; throw if a required input is unsatisfied. */
export function resolveInputs(agent: Agent, supplied: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of agent.inputs) {
    const v = supplied[f.name] ?? f.default;
    if (f.required && (v === undefined || v === null || v === "")) throw new MissingRequiredInputError(f.name);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

/**
 * Compile an agent into an ephemeral single-step WorkflowGraph:
 *   trigger-manual → agent-run step → end
 * The agent-run step config carries everything the handler needs.
 */
export function compileAgentToGraph(
  agent: Agent,
  suppliedInputs: Record<string, unknown> = {},
): { graph: WorkflowGraph; inputs: Record<string, unknown> } {
  const inputs = resolveInputs(agent, suppliedInputs);

  const graph: WorkflowGraph = {
    schemaVersion: 2,
    nodes: [
      { id: "trigger-1", type: "trigger-manual", displayName: "Start" },
      {
        id: "agent-run-1",
        type: "step",
        stepType: "agent-run",
        displayName: agent.name,
        sandboxId: agent.sandboxId,
        model: agent.model ?? null,
        retry: agent.behavior.retry ?? null,
        executorConfig: { provider: agent.provider },
        config: {
          agentId: agent.id,
          instructions: agent.instructions,
          provider: agent.provider,
          tools: agent.permissions.allowedTools.length ? agent.permissions.allowedTools : agent.tools,
          mcpInstanceIds: agent.connectorMcpIds,
          skillPackageIds: agent.skillIds,
          repos: agent.repoSelections.map((r) => r.repo),
          repoBranch: agent.repoSelections[0]?.branch,
          outputMode: agent.outputMode,
          outputFields: agent.outputFields ?? [],
          maxSteps: agent.behavior.maxTurns,
        },
      },
      { id: "end-1", type: "end", displayName: "Done" },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "agent-run-1" },
      { id: "e2", source: "agent-run-1", target: "end-1" },
    ],
  };

  return { graph, inputs };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @journeyman/agents test -- compile.test.ts`
Expected: PASS. If `WorkflowEdge` requires more fields than `{id,source,target}`, add them to match `flow.types.ts` (check the type and the test will catch it via typecheck).

- [ ] **Step 5: Typecheck the package**

Run: `npm --workspace @journeyman/agents run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/compile.ts packages/agents/src/compile.test.ts
git commit -m "feat(agents): fire-time compiler agent → WorkflowGraph"
```

---

## Task 6: Readiness check (readiness.ts)

**Files:**
- Create: `packages/agents/src/readiness.ts`
- Test: `packages/agents/src/readiness.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agents/src/readiness.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { checkReadiness } from "./readiness.ts";
import type { Agent } from "@journeyman/core";

const ok: Agent = {
  id: "a", scope: "org", orgId: "o", name: "A", instructions: "do it",
  inputs: [], provider: "claude", model: "claude-opus-4-8",
  connectorMcpIds: [], tools: [], skillIds: [], repoSelections: [],
  permissions: { allowedTools: [] }, notifications: { on: [] },
  outputMode: "text", behavior: {}, triggers: [], status: "draft", enabled: false,
  createdBy: "u", createdAt: "", updatedAt: "",
};

describe("checkReadiness", () => {
  it("passes a minimal valid agent", () => {
    expect(checkReadiness(ok)).toEqual([]);
  });
  it("flags empty instructions and missing model", () => {
    const errs = checkReadiness({ ...ok, instructions: "  ", model: undefined });
    expect(errs.some((e) => e.field === "instructions")).toBe(true);
    expect(errs.some((e) => e.field === "model")).toBe(true);
  });
  it("requires a sandbox when workspace tools are used", () => {
    const errs = checkReadiness({ ...ok, tools: ["bash"], sandboxId: undefined });
    expect(errs.some((e) => e.field === "sandbox")).toBe(true);
  });
  it("flags a required input a schedule trigger cannot fill", () => {
    const errs = checkReadiness({
      ...ok,
      inputs: [{ name: "k", type: "text", required: true }],
      triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
    });
    expect(errs.some((e) => e.field === "inputs")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @journeyman/agents test -- readiness.test.ts`
Expected: FAIL — `checkReadiness` not defined.

- [ ] **Step 3: Write the readiness check**

Create `packages/agents/src/readiness.ts`:

```typescript
import type { Agent } from "@journeyman/core";
import { toolsRequireWorkspace } from "@journeyman/core";

export interface ReadinessError { field: string; message: string; }

const IMPLEMENTED_PROVIDERS = new Set(["claude", "opencode", "aisdk"]);

/** Returns [] when the agent may be enabled; otherwise a list of blocking errors. */
export function checkReadiness(agent: Agent): ReadinessError[] {
  const errs: ReadinessError[] = [];

  if (!agent.name.trim()) errs.push({ field: "name", message: "Name is required" });
  if (!agent.instructions.trim()) errs.push({ field: "instructions", message: "Instructions are required" });
  if (!IMPLEMENTED_PROVIDERS.has(agent.provider)) errs.push({ field: "provider", message: "Choose an implemented provider" });
  if (!agent.model) errs.push({ field: "model", message: "Choose a model" });

  const usesWorkspace = toolsRequireWorkspace(agent.permissions.allowedTools.length ? agent.permissions.allowedTools : agent.tools);
  if (usesWorkspace && !agent.sandboxId) errs.push({ field: "sandbox", message: "Workspace tools require a sandbox" });

  // Required-input satisfiability (Phase 1 only validates schedule, since only manual fires now).
  const hasScheduleTrigger = agent.triggers.some((t) => t.type === "schedule");
  if (hasScheduleTrigger) {
    const schedule = agent.triggers.find((t) => t.type === "schedule") as Extract<Agent["triggers"][number], { type: "schedule" }>;
    for (const f of agent.inputs) {
      const fixed = schedule.fixedInputs?.[f.name];
      const hasDefault = f.default !== undefined;
      if (f.required && fixed === undefined && !hasDefault) {
        errs.push({ field: "inputs", message: `Required input "${f.name}" has no value the schedule can supply (add a default or fixed value)` });
      }
    }
  }

  return errs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @journeyman/agents test -- readiness.test.ts`
Expected: PASS (all four). If `toolsRequireWorkspace` isn't exported from `@journeyman/core`, import it from its actual module (it's used in `custom-ai-step-handler.ts` via `@journeyman/core`).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/readiness.ts packages/agents/src/readiness.test.ts
git commit -m "feat(agents): enable-readiness check"
```

---

## Task 7: agent-run step handler

Mirrors `CustomAiStepHandler` but reads inline config from the node (not a `customStepId`) and clones `repos` first.

**Files:**
- Create: `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`
- Test: `packages/orchestrator/src/workers/steps/agent-run-step-handler.test.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/orchestrator/src/workers/steps/agent-run-step-handler.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { AgentRunStepHandler } from "./agent-run-step-handler.ts";

function ctx(over: Partial<any> = {}): any {
  return {
    workflowInstanceId: "wi1", nodeId: "n1", attempt: 1, workspaceDir: "/ws",
    signal: new AbortController().signal, env: {}, workflowInputs: {},
    log: vi.fn(), ...over,
  };
}

describe("AgentRunStepHandler", () => {
  it("needsWorkspaceFor is true when repos are present", async () => {
    const h = new AgentRunStepHandler({ coding: vi.fn(), git: vi.fn(), bindingResolver: vi.fn() } as any);
    expect(await h.needsWorkspaceFor({ repos: ["acme/api"] } as any)).toBe(true);
    expect(await h.needsWorkspaceFor({ tools: ["bash"] } as any)).toBe(true);
    expect(await h.needsWorkspaceFor({ tools: [] } as any)).toBe(false);
  });

  it("clones repos then runs the prompt and returns text output", async () => {
    const cloneRepos = vi.fn().mockResolvedValue({ repos: [{ folderName: "api" }] });
    const runCustomPrompt = vi.fn().mockResolvedValue({ result: "done" });
    const h = new AgentRunStepHandler({
      coding: () => ({ runCustomPrompt }),
      git: () => ({ cloneRepos }),
      bindingResolver: vi.fn().mockResolvedValue({}),
    } as any);
    const res = await h.run(
      { instructions: "hi", provider: "claude", repos: ["acme/api"], tools: ["bash"], outputMode: "text", maxSteps: 40 } as any,
      ctx(),
    );
    expect(cloneRepos).toHaveBeenCalled();
    expect(runCustomPrompt).toHaveBeenCalledWith(expect.objectContaining({ prompt: "hi", maxSteps: 40 }));
    expect(res).toEqual({ kind: "success", output: { result: "done" } });
  });

  it("fails (not retryable) when instructions are missing", async () => {
    const h = new AgentRunStepHandler({ coding: vi.fn(), git: vi.fn(), bindingResolver: vi.fn() } as any);
    const res = await h.run({ provider: "claude" } as any, ctx());
    expect(res.kind).toBe("failure");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @journeyman/orchestrator test -- agent-run-step-handler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the handler**

Create `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`:

```typescript
import type { Pool } from "pg";
import {
  createLogger, toolsRequireWorkspace, parseRepoList,
  type CanonicalTool, type ICodingCLI, type IGitProvider, type ProviderFactory,
  type IStepHandler, type StepContext, type StepInput, type StepRunResult,
  type ResolvedMcpInstance, type ResolvedSkillPackage, type SecretBinding, type CodingModelConfig,
  PROVIDER_CATALOG, defaultProviderForKind, openCodeModelSlots,
} from "@journeyman/core";
import { SandboxInstanceCodingProvider } from "../../sandbox/sandbox-instance-coding-provider.ts";
import { SandboxInstanceGitProvider } from "../../sandbox/sandbox-instance-git-provider.ts";
import { placeSkills } from "../skill-placement.ts";

const log = createLogger("worker:agent-run");

type CodingFactory = (key: string | undefined, env: Record<string, string>) => ICodingCLI;
type BindingResolver = (input: {
  ctx: { userId: string | null; orgId: string | null; workflowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}) => Promise<Record<string, string>>;

export class AgentRunStepHandler implements IStepHandler {
  readonly stepType = "agent-run";
  readonly requiresWorkspace = false;

  constructor(private deps: { coding: CodingFactory; git: ProviderFactory<IGitProvider>; pool: Pool; bindingResolver: BindingResolver }) {}

  async needsWorkspaceFor(input: StepInput): Promise<boolean> {
    const tools = Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) : [];
    const hasRepos = parseRepoList(input.repos as string | string[] | undefined).length > 0;
    const hasSkills = Array.isArray(input.skills) && (input.skills as unknown[]).length > 0;
    const hasMcps = Array.isArray(input.mcps) && (input.mcps as unknown[]).length > 0;
    return hasRepos || toolsRequireWorkspace(tools) || hasSkills || hasMcps;
  }

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const instructions = typeof input.instructions === "string" ? input.instructions.trim() : "";
    if (!instructions) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "agent-run requires instructions", retryable: false } };
    }

    const provider = typeof input.provider === "string" ? input.provider : defaultProviderForKind("coding-cli")?.value;
    const tools: CanonicalTool[] = Array.isArray(input.tools) ? (input.tools as CanonicalTool[]) : [];
    const needsWorkspace = await this.needsWorkspaceFor(input);
    const cwd = needsWorkspace && ctx.workspaceDir ? ctx.workspaceDir : undefined;

    // 1) Clone repos (if any) into the workspace, reusing the git provider's cloneRepos.
    const repos = parseRepoList(input.repos as string | string[] | undefined);
    if (repos.length > 0) {
      const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
        ? new SandboxInstanceGitProvider(ctx.exec)
        : this.deps.git(provider, ctx.env);
      const branch = typeof input.repoBranch === "string" ? input.repoBranch : undefined;
      for (const r of repos) ctx.log(`Cloning ${r}…`);
      const cloneRes = await git.cloneRepos({ repos, workspaceDir: ctx.workspaceDir, branch, signal: ctx.signal });
      if (cloneRes?.error) {
        return { kind: "failure", failure: { errorClass: "CloneReposFailed", message: String(cloneRes.error), retryable: true } };
      }
    }

    // 2) Resolve secret slots (provider framework slots + model slots).
    const userId = typeof input.startedByUserId === "string" ? input.startedByUserId : null;
    const orgId = typeof input.startedByOrgId === "string" ? input.startedByOrgId : null;
    const workflowId = typeof input.workflowId === "string" ? input.workflowId : null;
    const modelConfig = (input.modelConfig as CodingModelConfig | undefined) ?? undefined;
    const declaredBindings = (input.secretBindings as Record<string, SecretBinding> | undefined) ?? {};

    const providerSlots = PROVIDER_CATALOG.find((p) => p.kind === "coding-cli" && p.value === provider)?.slots ?? [];
    const slotsByName = new Map<string, { name: string; optional?: boolean }>();
    for (const s of providerSlots) slotsByName.set(s.name, s);
    for (const s of openCodeModelSlots(modelConfig)) slotsByName.set(s.name, { name: s.name, optional: s.optional });
    const effectiveSlots = Array.from(slotsByName.values());

    let env: Record<string, string>;
    try {
      env = await this.deps.bindingResolver({ ctx: { userId, orgId, workflowId }, slots: effectiveSlots, bindings: declaredBindings });
    } catch (err: any) {
      return { kind: "failure", failure: { errorClass: "SecretResolutionFailed", message: err?.message ?? String(err), retryable: false } };
    }

    // 3) Run the agentic loop.
    const coding = ctx.exec ? new SandboxInstanceCodingProvider(ctx.exec, provider) : this.deps.coding(provider, ctx.env);
    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    let skills: ResolvedSkillPackage[] | undefined = Array.isArray(input.skills) ? (input.skills as ResolvedSkillPackage[]) : undefined;
    const model = typeof input.model === "string" && input.model ? input.model : undefined;
    const outputMode = (input.outputMode as "none" | "text" | "structured") ?? "text";
    const maxSteps = typeof input.maxSteps === "number" && input.maxSteps > 0 ? input.maxSteps : undefined;

    if (ctx.exec && ctx.materialize && skills && skills.length) {
      skills = await placeSkills(provider, skills, { materialize: ctx.materialize });
    }

    ctx.log(`Running agent "${input.displayName ?? "agent"}" (${outputMode})`);
    const result = await coding.runCustomPrompt({
      prompt: instructions,
      outputMode,
      outputSchema: outputMode === "structured" ? (input.outputSchema as Record<string, unknown> | undefined) : undefined,
      cwd, mcps, skills, tools, env,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      ...(model ? { model } : {}),
      ...(modelConfig ? { modelConfig } : {}),
      ...(maxSteps ? { maxSteps } : {}),
    });

    if (result.error) {
      log.error({ err: result.error }, "agent-run failed");
      return { kind: "failure", failure: { errorClass: "AgentRunFailed", message: result.error, retryable: true } };
    }
    if (outputMode === "none") return { kind: "success", output: {} };
    if (outputMode === "text") return { kind: "success", output: { result: result.result ?? "" } };
    return { kind: "success", output: (result.structured as Record<string, unknown>) ?? {} };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @journeyman/orchestrator test -- agent-run-step-handler.test.ts`
Expected: PASS (all three). If `outputSchema` for structured mode needs building from `outputFields`, the compiler can pass `outputSchema` directly; Phase 1 tests use text mode.

- [ ] **Step 5: Register the handler**

In `packages/orchestrator/src/cli-worker.ts`, near the other `registry.register(...)` calls (where `CustomAiStepHandler` and `CloneReposStepHandler` are registered, ~lines 198–226), add the import at top and the registration inside the `if (pool)` block:

```typescript
import { AgentRunStepHandler } from "./workers/steps/agent-run-step-handler.ts";
// ...
if (pool) {
  // ...existing CustomAiStepHandler registration...
  registry.register(new AgentRunStepHandler({ coding, git, pool, bindingResolver: (input) => cliBindingResolver(input) }));
}
```

- [ ] **Step 6: Wire timeout enforcement in the worker harness**

The handler passes `ctx.signal` to `runCustomPrompt`, but nothing aborts that signal on a timeout yet. The worker harness already creates an `AbortController` per step (see `packages/orchestrator/src/workers/worker-harness.ts` around line 144 — the `AbortController` whose `.signal` becomes `ctx.signal`). Add a timeout that fires `abort()`:

Locate where the harness builds the per-step `AbortController` and the `StepContext`. Read the node's `behavior.timeoutSeconds` — in Phase 1 the compiler can place `timeoutSeconds` into the `agent-run` node `config` (add `timeoutSeconds: agent.behavior.timeoutSeconds` to the `config` object in `compile.ts` Task 5). Then in the harness, after creating the controller:

```typescript
// after: const controller = new AbortController();
const timeoutSeconds = typeof node.config?.timeoutSeconds === "number" ? node.config.timeoutSeconds : undefined;
const timeoutHandle = timeoutSeconds && timeoutSeconds > 0
  ? setTimeout(() => controller.abort(new DOMException("Step timed out", "TimeoutError")), timeoutSeconds * 1000)
  : undefined;
// ...and in the finally block after the step completes:
if (timeoutHandle) clearTimeout(timeoutHandle);
```

(Match the harness's actual variable names — `node`/`controller`/the run try-finally. If config isn't directly visible at that point, pass `timeoutSeconds` through the same path the harness already uses to read node config.)

- [ ] **Step 7: Add timeoutSeconds to the compiler config**

In `packages/agents/src/compile.ts` (Task 5), add to the `agent-run-1` node `config`:

```typescript
timeoutSeconds: agent.behavior.timeoutSeconds,
```

- [ ] **Step 8: Typecheck orchestrator**

Run: `npm --workspace @journeyman/orchestrator run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/orchestrator/src/workers/steps/agent-run-step-handler.ts packages/orchestrator/src/workers/steps/agent-run-step-handler.test.ts packages/orchestrator/src/cli-worker.ts packages/orchestrator/src/workers/worker-harness.ts packages/agents/src/compile.ts
git commit -m "feat(orchestrator): agent-run step + per-step timeout enforcement"
```

---

## Task 8: API routes — CRUD + enable/disable + run-now

**Files:**
- Create: `packages/api-server/src/routes/agents.ts`
- Modify: wherever routes are registered (search `routes/flows.ts` registration in `app.ts`/`server.ts`)

- [ ] **Step 1: Write the routes**

Create `packages/api-server/src/routes/agents.ts`. Follow the existing route style in `packages/api-server/src/routes/flows.ts` (the `requireAuth()` preHandler, `req.runContext`, `callerFromCtx`, zod body parsing, and `c.orchestrator.submit`). Use the container `c` the other routes use; replace `c.agents`/`c.pool` with the actual accessors the server exposes (check how `flows.ts` reaches the pool / stores).

```typescript
import { z } from "zod";
import { insertAgent, getAgent, listAgents, updateAgent, deleteAgent } from "@journeyman/agents";
import { compileAgentToGraph, checkReadiness } from "@journeyman/agents";
import type { FastifyInstance } from "fastify";

const createBody = z.object({ scope: z.enum(["user", "org"]), name: z.string().min(1) });
const runBody = z.object({ inputs: z.record(z.unknown()).default({}) });

export function registerAgentRoutes(app: FastifyInstance, c: any) {
  const pool = c.pool; // adjust to the server's pool accessor

  // List (user-scoped)
  app.get("/orgs/:orgId/users/me/agents", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    return listAgents(pool, ctx.org.id, caller.userId);
  });

  // List (org-scoped)
  app.get("/orgs/:orgId/agents", { preHandler: requireAuth() }, async (req) => {
    const ctx = req.runContext!;
    return listAgents(pool, ctx.org.id, null);
  });

  // Create (name-first draft)
  app.post("/orgs/:orgId/agents", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const body = createBody.parse(req.body);
    const agent = await insertAgent(pool, {
      scope: body.scope, name: body.name,
      orgId: ctx.org.id, userId: body.scope === "user" ? caller.userId : null, createdBy: caller.userId!,
      instructions: "", inputs: [], provider: "claude", connectorMcpIds: [], tools: [], skillIds: [],
      repoSelections: [], permissions: { allowedTools: [] }, notifications: { on: [] },
      outputMode: "text", behavior: {}, triggers: [], status: "draft", enabled: false,
    } as any);
    reply.code(201); return agent;
  });

  // Get
  app.get("/orgs/:orgId/agents/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await getAgent(pool, id);
    if (!agent) { reply.code(404); return { error: "not_found" }; }
    return agent;
  });

  // Update (blocked while enabled — see §9 enabled=read-only)
  app.patch("/orgs/:orgId/agents/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await getAgent(pool, id);
    if (!existing) { reply.code(404); return { error: "not_found" }; }
    if (existing.enabled) { reply.code(409); return { error: "agent_enabled_readonly" }; }
    const patch = req.body as Record<string, unknown>;
    return updateAgent(pool, id, patch as any);
  });

  // Enable — runs readiness gate
  app.post("/orgs/:orgId/agents/:id/enable", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await getAgent(pool, id);
    if (!agent) { reply.code(404); return { error: "not_found" }; }
    const errors = checkReadiness(agent);
    if (errors.length) { reply.code(422); return { error: "not_ready", errors }; }
    return updateAgent(pool, id, { status: "active", enabled: true } as any);
  });

  // Disable
  app.post("/orgs/:orgId/agents/:id/disable", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = await getAgent(pool, id);
    if (!agent) { reply.code(404); return { error: "not_found" }; }
    return updateAgent(pool, id, { enabled: false } as any);
  });

  // Delete
  app.delete("/orgs/:orgId/agents/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteAgent(pool, id);
    reply.code(ok ? 204 : 404); return ok ? undefined : { error: "not_found" };
  });

  // Run now (manual) — compile + submit; allowed in draft (test run) and active.
  app.post("/orgs/:orgId/agents/:id/runs", { preHandler: requireAuth() }, async (req, reply) => {
    const ctx = req.runContext!; const caller = callerFromCtx(ctx);
    const { id } = req.params as { id: string };
    const body = runBody.parse(req.body);
    const agent = await getAgent(pool, id);
    if (!agent) { reply.code(404); return { error: "not_found" }; }

    let compiled;
    try { compiled = compileAgentToGraph(agent, body.inputs); }
    catch (err: any) { reply.code(422); return { error: "invalid_inputs", message: err?.message ?? String(err) }; }

    const { workflowInstanceId, engineWorkflowId } = await c.orchestrator.submit({
      workflowId: null, workflowVersionId: null,
      workflowNameSnapshot: agent.name, workflowScopeSnapshot: agent.scope,
      definitionSnapshot: compiled.graph, inputs: { ...compiled.inputs, agentId: agent.id, startedByUserId: caller.userId, startedByOrgId: ctx.org.id },
      startedByUserId: caller.userId, startedByOrgId: ctx.org.id,
      triggerSource: "manual", triggerNodeId: "trigger-1",
    });
    reply.code(202); return { workflowInstanceId, engineWorkflowId };
  });
}
```

> **Note for the implementer:** `requireAuth`/`callerFromCtx` are imported the same way `flows.ts` imports them — copy those imports from `flows.ts`. The `inputs` passed to `submit` include `agentId/startedByUserId/startedByOrgId` so the `agent-run` handler can read them off `StepInput` (as `custom-ai` does). Confirm how node `config` merges into `StepInput` at execution (the converter spreads node `config` + run inputs); if config isn't auto-merged into StepInput, the compiler already places the agent fields in node `config`, which the worker harness passes as the step input.

- [ ] **Step 2: Mount the routes**

Find where `flows` routes are registered (search `registerFlowRoutes` or `routes/flows` in `packages/api-server/src/`). Add the same way:

```typescript
import { registerAgentRoutes } from "./routes/agents.ts";
// ... where other routes register, with the same `app` + container `c`:
registerAgentRoutes(app, c);
```

- [ ] **Step 3: Typecheck api-server**

Run: `npm --workspace @journeyman/api-server run typecheck`
Expected: PASS. Fix any mismatch in how `pool`/`orchestrator` are accessed off the container to match `flows.ts`.

- [ ] **Step 4: Manual smoke test (create → run)**

Start infra + api + worker (`npm run infra:up && npm run migrate && npm run start:api-server` and `npm run start:worker` in another shell). Then:

```bash
# Create a draft agent
curl -s -X POST localhost:3000/api/orgs/$ORG/agents -H 'Content-Type: application/json' --cookie "$AUTH" -d '{"scope":"org","name":"smoke"}'
# Patch instructions + provider/model + a no-workspace tool set
curl -s -X PATCH localhost:3000/api/orgs/$ORG/agents/$AID --cookie "$AUTH" -H 'Content-Type: application/json' -d '{"instructions":"Say hello","provider":"claude","model":"claude-opus-4-8","outputMode":"text"}'
# Run now
curl -s -X POST localhost:3000/api/orgs/$ORG/agents/$AID/runs --cookie "$AUTH" -H 'Content-Type: application/json' -d '{"inputs":{}}'
```

Expected: create → 201 with agent JSON; run → 202 with `workflowInstanceId`; the worker logs show the `agent-run` step executing and producing text output.

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/routes/agents.ts packages/api-server/src/<route-registration-file>
git commit -m "feat(api): agents CRUD + enable/disable + run-now"
```

---

**END OF PART A.** At this point an agent can be created, configured, enabled (with readiness validation), and run manually via API — fully testable without UI. Part B adds the UI.

---

# PART B — Web UI

## Task 9: Web API client (agents.ts)

**Files:**
- Create: `packages/web/src/api/agents.ts`

- [ ] **Step 1: Write the client**

Create `packages/web/src/api/agents.ts`, mirroring `packages/web/src/api/customSteps.ts`:

```typescript
import type { Agent, AgentCreateInput, AgentUpdateInput } from "@journeyman/core";

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/agents`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/agents`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) { if (r.status === 204) return undefined as T; return r.json() as Promise<T>; }
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

const base = (orgId: string, scope: "user" | "org") => (scope === "user" ? userBase(orgId) : orgBase(orgId));

export const agentsApi = {
  listMine: (orgId: string) => fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<Agent[]>),
  listOrg: (orgId: string) => fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<Agent[]>),
  get: (orgId: string, id: string) => fetch(`${orgBase(orgId)}/${id}`, { credentials: "include" }).then(jsonOrThrow<Agent>),
  create: (orgId: string, body: { scope: "user" | "org"; name: string }) =>
    fetch(base(orgId, body.scope), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(jsonOrThrow<Agent>),
  update: (orgId: string, id: string, patch: AgentUpdateInput) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then(jsonOrThrow<Agent>),
  enable: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/enable`, { method: "POST", credentials: "include" }).then(jsonOrThrow<Agent>),
  disable: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/disable`, { method: "POST", credentials: "include" }).then(jsonOrThrow<Agent>),
  remove: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(jsonOrThrow<void>),
  runNow: (orgId: string, id: string, inputs: Record<string, unknown>) =>
    fetch(`${orgBase(orgId)}/${id}/runs`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inputs }) }).then(jsonOrThrow<{ workflowInstanceId: string }>),
};
```

- [ ] **Step 2: Typecheck web**

Run: `npm --workspace @journeyman/web run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/agents.ts
git commit -m "feat(web): agents API client"
```

---

## Task 10: Agents list + pages + nav

**Files:**
- Create: `packages/web/src/components/agents/AgentsList.tsx`, `packages/web/src/routes/MyAgentsPage.tsx`, `packages/web/src/routes/AdminAgentsPage.tsx`
- Modify: `packages/web/src/App.tsx`, `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: AgentsList component**

Create `packages/web/src/components/agents/AgentsList.tsx`, mirroring `CustomStepsList.tsx`:

```tsx
import { useEffect, useState, useCallback } from "react";
import { agentsApi } from "../../api/agents.ts";
import type { Agent } from "@journeyman/core";
import { EditAgentModal } from "./EditAgentModal.tsx";
import { btnPrimary, btnGhost, btnDanger, card } from "../../routes/admin-styles.ts";

export function AgentsList({ orgId, scope }: { orgId: string; scope: "user" | "org" }) {
  const [items, setItems] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems(scope === "user" ? await agentsApi.listMine(orgId) : await agentsApi.listOrg(orgId)); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setLoading(false); }
  }, [orgId, scope]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createDraft = async () => {
    try { const a = await agentsApi.create(orgId, { scope, name: newName.trim() }); setCreating(false); setNewName(""); setEditing(a); await refresh(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
  };

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold">Agents</h2>
        <button className={btnPrimary} onClick={() => setCreating(true)}>+ Create agent</button>
      </div>
      {error && <div className="px-4 py-2 text-sm text-destructive">{error}</div>}
      {creating && (
        <div className="p-4 flex gap-2 border-b">
          <input autoFocus className="flex-1 rounded-md border px-3 py-2 text-sm bg-transparent" placeholder="Agent name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className={btnPrimary} disabled={!newName.trim()} onClick={createDraft}>Create draft</button>
          <button className={btnGhost} onClick={() => setCreating(false)}>Cancel</button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted-foreground"><th className="px-4 py-2">Name</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Triggers</th><th className="px-4 py-2"></th></tr></thead>
        <tbody>
          {loading && <tr><td className="px-4 py-3" colSpan={4}>Loading…</td></tr>}
          {!loading && items.length === 0 && <tr><td className="px-4 py-3 text-muted-foreground" colSpan={4}>No agents yet</td></tr>}
          {items.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="px-4 py-2 font-medium">{a.name}</td>
              <td className="px-4 py-2">{a.enabled ? "enabled" : a.status}</td>
              <td className="px-4 py-2 text-muted-foreground">{a.triggers.map((t) => t.type).join(", ") || "manual"}</td>
              <td className="px-4 py-2 text-right">
                <button className={btnGhost} onClick={() => setEditing(a)}>Open</button>
                <button className={btnDanger} onClick={async () => { await agentsApi.remove(orgId, a.id); await refresh(); }}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <EditAgentModal orgId={orgId} agent={editing} onClose={() => { setEditing(null); void refresh(); }} />}
    </div>
  );
}
```

- [ ] **Step 2: Pages**

Create `packages/web/src/routes/MyAgentsPage.tsx`:

```tsx
import { AgentsList } from "../components/agents/AgentsList.tsx";
export function MyAgentsPage({ orgId }: { orgId: string }) {
  return (
    <div className="h-full overflow-y-auto"><div className="w-full px-6 py-10 space-y-8">
      <header><h1 className="text-2xl font-semibold">My Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">Autonomous agents you own.</p></header>
      <AgentsList orgId={orgId} scope="user" />
    </div></div>
  );
}
```

Create `packages/web/src/routes/AdminAgentsPage.tsx`:

```tsx
import { AgentsList } from "../components/agents/AgentsList.tsx";
export function AdminAgentsPage({ orgId }: { orgId: string }) {
  return (
    <div className="h-full overflow-y-auto"><div className="w-full px-6 py-10 space-y-8">
      <header><h1 className="text-2xl font-semibold">Org Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">Agents shared with the org.</p></header>
      <AgentsList orgId={orgId} scope="org" />
    </div></div>
  );
}
```

- [ ] **Step 3: Routes + nav**

In `packages/web/src/App.tsx`, add imports and routes alongside the custom-steps routes:

```tsx
import { MyAgentsPage } from "./routes/MyAgentsPage.tsx";
import { AdminAgentsPage } from "./routes/AdminAgentsPage.tsx";
// inside the <Route> list:
<Route path="/me/agents" element={<MyAgentsPage orgId={activeOrgId} />} />
<Route path="/admin/agents" element={role === "admin" ? <AdminAgentsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
```

In `packages/web/src/components/Sidebar.tsx`, add to `NAV_ITEMS` and `ADMIN_ITEMS`:

```tsx
{ to: "/me/agents", icon: "🤖", label: "My Agents" },     // NAV_ITEMS
{ to: "/admin/agents", icon: "🤖", label: "Org Agents" }, // ADMIN_ITEMS
```

- [ ] **Step 4: Typecheck + run web**

Run: `npm --workspace @journeyman/web run typecheck`
Expected: PASS (EditAgentModal exists after Task 11; if running this task first, stub it). Then verify in the browser via the preview workflow: the "My Agents" nav appears, the page lists agents, "+ Create agent" creates a draft and opens the editor.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/AgentsList.tsx packages/web/src/routes/MyAgentsPage.tsx packages/web/src/routes/AdminAgentsPage.tsx packages/web/src/App.tsx packages/web/src/components/Sidebar.tsx
git commit -m "feat(web): agents list pages + nav"
```

---

## Task 11: Tabbed agent editor (EditAgentModal)

**Files:**
- Create: `packages/web/src/components/agents/EditAgentModal.tsx`

Reuses `ToolsPicker` and `CodingModelSelect` (both confirmed reusable in the web package).

- [ ] **Step 1: Write the editor**

Create `packages/web/src/components/agents/EditAgentModal.tsx`, mirroring `EditCustomStepModal.tsx`'s tab structure:

```tsx
import { useState } from "react";
import type { Agent, AgentUpdateInput, CanonicalTool } from "@journeyman/core";
import { agentsApi } from "../../api/agents.ts";
import { ToolsPicker } from "../custom-steps/ToolsPicker.tsx";
import { CodingModelSelect } from "../CodingModelSelect.tsx";
import { btnPrimary, btnGhost, inputCls } from "../../routes/admin-styles.ts";

type TabId = "instructions" | "workspace" | "behavior" | "permissions" | "notifications";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "instructions", label: "Instructions & Inputs" },
  { id: "workspace", label: "Workspace & Model" },
  { id: "behavior", label: "Behavior" },
  { id: "permissions", label: "Permissions" },
  { id: "notifications", label: "Notifications" },
];

export function EditAgentModal({ orgId, agent, onClose }: { orgId: string; agent: Agent; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("instructions");
  const [a, setA] = useState<Agent>(agent);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = a.enabled; // enabled = read-only

  const patch = (p: AgentUpdateInput) => setA((prev) => ({ ...prev, ...p } as Agent));

  const saveSection = async (p: AgentUpdateInput) => {
    setBusy(true); setError(null);
    try { setA(await agentsApi.update(orgId, a.id, p)); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const toggleEnable = async () => {
    setBusy(true); setError(null);
    try { setA(a.enabled ? await agentsApi.disable(orgId, a.id) : await agentsApi.enable(orgId, a.id)); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card text-card-foreground border rounded-lg shadow-card">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-semibold">{a.name} {a.enabled ? "· ENABLED" : `· ${a.status}`}</div>
          <div className="flex gap-2">
            <button className={btnGhost} disabled={busy} onClick={toggleEnable}>{a.enabled ? "Disable to edit" : "Enable"}</button>
            <button className={btnGhost} onClick={onClose}>Close</button>
          </div>
        </div>

        {locked && <div className="px-4 py-2 text-sm bg-muted text-muted-foreground">🔒 Enabled — disable to edit.</div>}

        <div className="flex gap-1 border-b px-2">
          {TABS.map((t) => (
            <button key={t.id} className={`px-3 py-2 text-sm border-b-2 ${tab === t.id ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {error && <div className="text-sm text-destructive">{error}</div>}

          {tab === "instructions" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Instructions</label>
              <textarea className={`${inputCls} min-h-[120px]`} disabled={locked} value={a.instructions} onChange={(e) => patch({ instructions: e.target.value })} />
              <div className="text-xs text-muted-foreground bg-muted rounded p-2">
                Use <code>{"{{name}}"}</code> to insert an input. Available: {a.inputs.map((i) => `{{${i.name}}}`).join(" · ") || "—"}, <code>{"{{payload}}"}</code>, <code>{"{{trigger.type}}"}</code>.
              </div>
              {!locked && <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ instructions: a.instructions, inputs: a.inputs })}>Save section</button>}
            </div>
          )}

          {tab === "workspace" && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Provider</label>
              <select className={inputCls} disabled={locked} value={a.provider} onChange={(e) => patch({ provider: e.target.value, model: undefined })}>
                <option value="claude">Claude</option><option value="opencode">OpenCode</option><option value="aisdk">AI-SDK</option>
              </select>
              <label className="text-sm font-medium">Model</label>
              <CodingModelSelect provider={a.provider} value={a.model} onChange={(m) => patch({ model: m })} disabled={locked} />
              <label className="text-sm font-medium">Repositories (one owner/repo or URL per line)</label>
              <textarea className={inputCls} disabled={locked} value={a.repoSelections.map((r) => r.repo).join("\n")} onChange={(e) => patch({ repoSelections: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).map((repo) => ({ repo, allowWrites: false })) })} />
              {!locked && <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ provider: a.provider, model: a.model, repoSelections: a.repoSelections })}>Save section</button>}
            </div>
          )}

          {tab === "behavior" && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Max steps</label>
              <input type="number" className={inputCls} disabled={locked} value={a.behavior.maxTurns ?? ""} onChange={(e) => patch({ behavior: { ...a.behavior, maxTurns: e.target.value ? Number(e.target.value) : undefined } })} />
              <label className="text-sm font-medium">Timeout (seconds)</label>
              <input type="number" className={inputCls} disabled={locked} value={a.behavior.timeoutSeconds ?? ""} onChange={(e) => patch({ behavior: { ...a.behavior, timeoutSeconds: e.target.value ? Number(e.target.value) : undefined } })} />
              <label className="text-sm font-medium">Output mode</label>
              <select className={inputCls} disabled={locked} value={a.outputMode} onChange={(e) => patch({ outputMode: e.target.value as Agent["outputMode"] })}>
                <option value="text">Text</option><option value="structured">Structured</option><option value="none">None</option>
              </select>
              {!locked && <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ behavior: a.behavior, outputMode: a.outputMode })}>Save section</button>}
            </div>
          )}

          {tab === "permissions" && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Allowed tools</label>
              <ToolsPicker value={a.permissions.allowedTools} onChange={(t: CanonicalTool[]) => patch({ permissions: { allowedTools: t }, tools: t })} />
              {!locked && <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ permissions: a.permissions, tools: a.tools })}>Save section</button>}
            </div>
          )}

          {tab === "notifications" && (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Notification delivery (Slack) arrives in a later phase. You can pre-select when to notify:</p>
              <label className="flex gap-2 items-center text-foreground"><input type="checkbox" disabled={locked} checked={a.notifications.on.includes("success")} onChange={(e) => patch({ notifications: { on: e.target.checked ? [...new Set([...a.notifications.on, "success" as const])] : a.notifications.on.filter((x) => x !== "success") } })} /> Notify on success</label>
              <label className="flex gap-2 items-center text-foreground"><input type="checkbox" disabled={locked} checked={a.notifications.on.includes("failure")} onChange={(e) => patch({ notifications: { on: e.target.checked ? [...new Set([...a.notifications.on, "failure" as const])] : a.notifications.on.filter((x) => x !== "failure") } })} /> Notify on failure</label>
              {!locked && <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ notifications: a.notifications })}>Save section</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck web**

Run: `npm --workspace @journeyman/web run typecheck`
Expected: PASS. If `ToolsPicker`/`CodingModelSelect` prop names differ, align to their real signatures (documented: `ToolsPicker {value,onChange,disabledTools?,unsupportedTools?}`, `CodingModelSelect {provider,value,onChange,disabled?}`).

- [ ] **Step 3: Verify in the browser**

Use the preview workflow: open My Agents → Create agent "demo" → editor opens → fill Instructions, pick Provider→Model on Workspace tab, set tools on Permissions → Save each section → click **Enable** (readiness passes) → confirm fields lock (read-only) → **Disable to edit** unlocks them.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/agents/EditAgentModal.tsx
git commit -m "feat(web): tabbed agent editor with draft/enable + read-only lock"
```

---

## Task 12: Run history (filter runs by agent)

Each run is a `WorkflowInstance` whose inputs carry `agentId`. Phase 1 surfaces them by reusing the existing runs-list, filtered to the agent.

**Files:**
- Modify: `packages/api-server/src/routes/agents.ts` (add a runs endpoint), `packages/web/src/components/agents/EditAgentModal.tsx` (add a Run history tab)

- [ ] **Step 1: Add the runs endpoint**

In `packages/api-server/src/routes/agents.ts`, add (using the same workflow-instance store the runs-list page uses — find it via how `RunsListPage` data is served, e.g. `c.workflowInstances.listByAgent` or a filter param):

```typescript
app.get("/orgs/:orgId/agents/:id/runs", { preHandler: requireAuth() }, async (req) => {
  const ctx = req.runContext!;
  const { id } = req.params as { id: string };
  // Reuse the workflow-instance store; filter by agentId tag stored on the instance inputs/metadata.
  return c.workflowInstances.list({ orgId: ctx.org.id, agentId: id });
});
```

> If the instance store has no `agentId` filter yet, add one: instances submitted for an agent carry `agentId` in their `inputs`; extend the store's list query with an optional `agentId` that matches `inputs->>'agentId'`. Keep it a thin addition mirroring existing filters.

- [ ] **Step 2: Add a Run history tab**

In `EditAgentModal.tsx`, add `"runs"` to `TabId` and `TABS`, fetch on open, and render a small table (reusing `WorkflowInstancesList` from `@journeyman/runs-list` if its props fit, else a simple table) linking each run to `/workflow-instances/:id`:

```tsx
// add to TabId union: | "runs"; add { id: "runs", label: "Run history" } to TABS
{ tab === "runs" && <AgentRuns orgId={orgId} agentId={a.id} /> }
```

Create the small `AgentRuns` inline component (same file) that calls `fetch(`/api/orgs/${orgId}/agents/${agentId}/runs`)` and lists `id · status · startedAt` with a link to the run detail page.

- [ ] **Step 3: Verify**

Run an agent (Run now), open the Run history tab, confirm the run appears and links to the run-viewer.

- [ ] **Step 4: Commit**

```bash
git add packages/api-server/src/routes/agents.ts packages/web/src/components/agents/EditAgentModal.tsx
git commit -m "feat(agents): run history (instances filtered by agentId)"
```

---

## Final verification

- [ ] **Run the full check**

Run: `npm run check` (typecheck + import boundaries) and `npm test`
Expected: PASS / no new failures (per the deps-campaign baseline, ignore the 5 known pre-existing failures).

- [ ] **End-to-end smoke**

Create an agent in the UI → set instructions + provider/model + a tool + a repo → Enable → Run now → watch the run in Run history → open it in the run-viewer and confirm the agent-run step executed and produced output.

---

## Notes for Phases 2–4 (not in this plan)

- **Phase 2:** Connections subsystem (`jm_connections`, git + notification), `GitLabProvider`, `listRepos`, the Connections-backed repo picker (replaces the textarea), the §7.5 delete-in-use guard.
- **Phase 3:** Automated triggers — webhook (presets/filters/mapping, HMAC/token/none), API token + `/fire`, scheduler tick; create-time reveal; idempotency/dedup store; per-key concurrency lock.
- **Phase 4:** `SlackProvider` + the auto-notification orchestrator hook; per-tool read/write permission granularity; safety rails (concurrency/daily-cap/budget) + observability (metrics/alerts/audit).
