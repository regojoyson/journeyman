# Custom Agents — Phase 3 Implementation Plan (Automated Triggers)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let an agent fire automatically — via **API** (per-agent bearer token → `/fire`), **Webhook** (reusing the existing webhook ingest + dedup, retargeted to the agent, with presets/filters/mapping), and **Schedule** (cron + timezone, a durable scheduler tick) — plus the **create-time reveal** of the webhook URL/secret and API token, and idempotency for API calls.

**Architecture:** All four trigger paths converge on one helper, `runAgent(c, agent, inputs, triggerSource, startedBy)`, which calls the existing `compileAgentToGraph` + `c.orchestrator.submit` (the manual run-now path, extracted). Webhook reuses `@journeyman/webhooks` + `ingestForWebhook` (delivery-id dedup already built) by tagging an agent's webhook record with `agentId` and adding an agent branch to the ingest. API uses identity's token primitives (`newApiToken`/`sha256`) in a dedicated `jm_agent_api_tokens` table + an `Idempotency-Key` dedup table. Schedule adds a greenfield, single-fire scheduler tick in the worker process.

**Tech Stack:** TS (ESM `.ts`), Postgres (`pg`), Fastify, `@journeyman/webhooks`, `@journeyman/identity` token helpers, `cron-parser` (new dep). Spec: `docs/superpowers/specs/2026-06-17-custom-agents-design.md` §5, §6, §15.1, §16.

**Reused, verified pieces:**
- `compileAgentToGraph(agent, inputs)` + `c.orchestrator.submit({... triggerSource})` — `packages/agents/src/compile.ts`, `packages/api-server/src/routes/agents.ts`.
- Webhook ingest with delivery-id dedup — `packages/api-server/src/services/webhook-ingest.ts` (`jm_webhook_events_delivery_idx`). `@journeyman/webhooks`: `verifyWebhookRequest`, `readPath`, `loadAllPresets`.
- Webhook records + `mintToken()` + inbound `POST /webhooks/in/:tenantToken` — `packages/api-server/src/routes/webhooks.ts`, `webhooks-management.ts`, `IWebhookStore`.
- Token primitives — `packages/identity/src/tokens.ts` (`newApiToken`, `sha256`, `API_TOKEN_PREFIX`).

---

## File structure

**New:**
- `packages/agents/src/run-agent.ts` — shared compile+submit helper + the JSONLogic filter / JSONPath mapping for webhook payloads
- `packages/agents/src/run-agent.test.ts`
- `packages/migrations/src/sql/046_agent_triggers.sql` — `jm_agent_api_tokens`, `jm_agent_idempotency`, `jm_agent_schedule_state`; + `agent_id` column on `jm_webhooks`
- `packages/api-server/src/routes/agent-triggers.ts` — token issue/rotate/revoke, `/fire`, webhook-provisioning, reveal
- `packages/orchestrator/src/scheduler/agent-scheduler.ts` — the scheduler tick
- `packages/orchestrator/src/scheduler/agent-scheduler.test.ts`

**Modified:**
- `packages/api-server/src/routes/agents.ts` — use `runAgent`; configure-trigger endpoints
- `packages/api-server/src/services/webhook-ingest.ts` — agent branch
- `packages/api-server/src/server.ts` — mount agent-trigger routes
- `packages/orchestrator/src/cli-worker.ts` — start the scheduler tick
- `packages/web/src/components/agents/EditAgentModal.tsx` — Triggers tab + reveal
- `packages/agents/package.json` — (none); `packages/orchestrator/package.json` — add `cron-parser`

---

## Task 1: Shared `runAgent` helper

**Files:** Create `packages/agents/src/run-agent.ts`, `packages/agents/src/run-agent.test.ts`; export from `packages/agents/src/index.ts`.

- [ ] **Step 1: Failing test** — `run-agent.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { applyWebhookMapping, matchesFilters } from "./run-agent.ts";

describe("applyWebhookMapping", () => {
  it("maps JSONPath payload fields to named inputs", () => {
    const out = applyWebhookMapping({ issue: { key: "PROJ-1" } }, { ticketKey: "$.issue.key" });
    expect(out).toEqual({ ticketKey: "PROJ-1" });
  });
});

describe("matchesFilters", () => {
  it("returns true when there are no filters", () => {
    expect(matchesFilters({ a: 1 }, undefined)).toBe(true);
  });
  it("evaluates a JSONLogic condition against the payload", () => {
    expect(matchesFilters({ type: "Bug" }, { "==": [{ var: "type" }, "Bug"] })).toBe(true);
    expect(matchesFilters({ type: "Task" }, { "==": [{ var: "type" }, "Bug"] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npm --workspace @journeyman/agents test -- run-agent.test.ts`

- [ ] **Step 3: Implement** `run-agent.ts`. Reuse the repo's JSONLogic evaluator (find it — webhook filters already use one; check `@journeyman/core` or `@journeyman/webhooks` for a `jsonLogic`/condition evaluator and import it; if none is exported, the webhook code references one — reuse that exact module). Use `readPath` from `@journeyman/webhooks` for mapping.

```typescript
import type { Agent } from "@journeyman/core";
import { readPath } from "@journeyman/webhooks";
import { compileAgentToGraph } from "./compile.ts";
// import the existing JSONLogic evaluator the webhook filters use, e.g.:
// import { evaluateCondition } from "@journeyman/core";  // adjust to the real export

export function applyWebhookMapping(payload: unknown, mapping: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(mapping ?? {})) out[name] = readPath(payload, path);
  return out;
}

export function matchesFilters(payload: unknown, filters: unknown): boolean {
  if (!filters) return true;
  // return evaluateCondition(filters, payload) === true;  // wire to the real evaluator
  return Boolean(/* evaluator */ (globalThis as any));
}

export interface RunAgentDeps {
  orchestrator: { submit: (args: any) => Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }> };
}

/** Compile an agent + submit a run. The single path all triggers funnel through. */
export async function runAgent(
  deps: RunAgentDeps,
  agent: Agent,
  inputs: Record<string, unknown>,
  triggerSource: "manual" | "api" | "webhook" | "schedule",
  startedBy: { userId: string | null; orgId: string },
  triggerNodeId = "trigger-1",
): Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }> {
  const compiled = compileAgentToGraph(agent, inputs);
  return deps.orchestrator.submit({
    workflowId: null,
    workflowVersionId: null,
    workflowNameSnapshot: agent.name,
    workflowScopeSnapshot: agent.scope,
    definitionSnapshot: compiled.graph,
    inputs: { ...compiled.inputs, agentId: agent.id },
    startedByUserId: startedBy.userId,
    startedByOrgId: startedBy.orgId,
    triggerSource,
    triggerNodeId,
  });
}
```

> **Implementer:** confirm the real JSONLogic evaluator export (grep the webhook filter code for how `acceptIf`/condition filters are evaluated — `webhook-trigger-fire.ts` uses one) and wire `matchesFilters` to it. The two pure functions (`applyWebhookMapping`, `matchesFilters`) are what the test pins; `runAgent` is the glue.

- [ ] **Step 4: Run → PASS.** Export all three from `index.ts`.

- [ ] **Step 5: Refactor run-now** — in `packages/api-server/src/routes/agents.ts`, replace the inline compile+submit in `POST .../agents/:id/runs` with `runAgent({ orchestrator: c.orchestrator }, agent, body.inputs ?? {}, "manual", { userId: ctx.user.id, orgId })`. Typecheck.

---

## Task 2: Migration — trigger tables + webhook.agent_id

**Files:** Create `packages/migrations/src/sql/046_agent_triggers.sql`.

- [ ] **Step 1: Write it**

```sql
-- 046_agent_triggers.sql — Phase 3 automated-trigger support.

-- Per-agent API tokens for the /fire endpoint (hashed; plaintext shown once).
CREATE TABLE IF NOT EXISTS jm_agent_api_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES jm_agents(id) ON DELETE CASCADE,
  org_id       UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT 'api',
  token_hash   TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jm_agent_api_tokens_agent ON jm_agent_api_tokens (agent_id);

-- Idempotency for API /fire calls.
CREATE TABLE IF NOT EXISTS jm_agent_idempotency (
  agent_id        UUID NOT NULL REFERENCES jm_agents(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  workflow_instance_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, idempotency_key)
);

-- Durable scheduler state (one row per scheduled agent).
CREATE TABLE IF NOT EXISTS jm_agent_schedule_state (
  agent_id      UUID PRIMARY KEY REFERENCES jm_agents(id) ON DELETE CASCADE,
  cron          TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  next_due_at   TIMESTAMPTZ NOT NULL,
  last_fired_at TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jm_agent_schedule_due ON jm_agent_schedule_state (next_due_at);

-- Bind a webhook record to an agent (the inbound webhook fires the agent).
ALTER TABLE jm_webhooks ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES jm_agents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_jm_webhooks_agent ON jm_webhooks (agent_id);
```

- [ ] **Step 2: Apply + verify** — `npm run migrate`; `psql "$DATABASE_URL" -c "\d jm_agent_api_tokens"`.

> Confirm the real `jm_webhooks` table name (the webhook store's table) before the `ALTER` — match it exactly.

---

## Task 3: API trigger — token store + `/fire`

**Files:** Create `packages/api-server/src/routes/agent-triggers.ts`; mount in `server.ts`.

- [ ] **Step 1: Token store helpers** (inline in the route file or a small `packages/agents` store fn). Reuse identity primitives:

```typescript
import { newApiToken, sha256 } from "@journeyman/identity"; // confirm these are exported from the package root; else import from the tokens module
```

- [ ] **Step 2: Issue / rotate / revoke routes**

```typescript
// POST /api/orgs/:orgId/agents/:id/triggers/api-token  → { token } (shown once)
app.post(".../agents/:id/triggers/api-token", { preHandler: requireAuth() }, async (req, reply) => {
  // verify agent in org; const { plaintext, hash } = newApiToken();
  // INSERT INTO jm_agent_api_tokens (agent_id, org_id, token_hash) VALUES (...)
  // reply.code(201); return { token: plaintext };  // reveal once
});
// DELETE .../triggers/api-token/:tokenId → revoke (set revoked_at)
```

- [ ] **Step 3: `/fire` endpoint** — NOT behind `requireAuth()`; authenticates with the agent token directly:

```typescript
app.post("/api/agents/:id/fire", async (req, reply) => {
  const { id } = req.params as { id: string };
  const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!auth) { reply.code(401); return { error: "missing_token" }; }
  const row = await c.pool!.query(
    `SELECT * FROM jm_agent_api_tokens WHERE agent_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
    [id, sha256(auth)],
  );
  if (!row.rows[0]) { reply.code(401); return { error: "invalid_token" }; }
  const agent = await getAgent(c.pool!, id);
  if (!agent) { reply.code(404); return { error: "not_found" }; }
  if (!agent.enabled) { reply.code(202); return { status: "skipped_disabled" }; }

  // Idempotency
  const idemKey = req.headers["idempotency-key"] as string | undefined;
  if (idemKey) {
    const dup = await c.pool!.query(
      `SELECT workflow_instance_id FROM jm_agent_idempotency WHERE agent_id = $1 AND idempotency_key = $2`,
      [id, idemKey],
    );
    if (dup.rows[0]) { reply.code(202); return { workflowInstanceId: dup.rows[0].workflow_instance_id, deduped: true }; }
  }

  const inputs = (req.body as { } | undefined) ?? {};
  let res;
  try {
    res = await runAgent({ orchestrator: c.orchestrator }, agent, inputs as Record<string, unknown>, "api",
      { userId: null, orgId: agent.orgId });
  } catch (err: any) { reply.code(422); return { error: "invalid_inputs", message: err?.message }; }

  if (idemKey) {
    await c.pool!.query(
      `INSERT INTO jm_agent_idempotency (agent_id, idempotency_key, workflow_instance_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [id, idemKey, res.workflowInstanceId],
    );
  }
  reply.code(202);
  return { workflowInstanceId: res.workflowInstanceId, status: "queued" };
});
```

- [ ] **Step 4: `touch last_used_at`** (fire-and-forget update). Typecheck.

---

## Task 4: Webhook trigger — provisioning + ingest branch

**Files:** Modify `packages/api-server/src/routes/agent-triggers.ts` (provisioning), `packages/api-server/src/services/webhook-ingest.ts` (agent branch).

- [ ] **Step 1: Provision a webhook bound to the agent**

```typescript
// POST /api/orgs/:orgId/agents/:id/triggers/webhook → creates a jm_webhooks record + sets agent_id
//   body: { preset?: "jira"|"github", auth: { type, header?, algorithm? }, filters?, inputsMapping }
//   reuse c.webhooks.create(...) + mintToken; persist the agent trigger config (preset/filters/mapping)
//     onto the agent.triggers (definition JSONB) referencing the created webhookId.
//   reply: { webhookId, inboundUrl: `/webhooks/in/${tenantToken}`, secret }   // reveal once
```

Store the trigger config (`preset`, `filters`, `inputsMapping`, `event`) on `agent.triggers` (already typed). Set `agent_id` on the webhook row.

- [ ] **Step 2: Ingest agent branch** — in `ingestForWebhook` (after the event row + auth + schema steps, before/alongside the workflow-trigger fire): if `webhook.agentId` is set, run the agent path instead of workflow triggers:

```typescript
if (webhook.agentId) {
  const agent = await getAgent(pool!, webhook.agentId);
  if (!agent || !agent.enabled) { /* mark processed; return { status: "ignored" } */ }
  const trigger = agent.triggers.find((t) => t.type === "webhook" && t.webhookId === webhook.id);
  if (trigger && trigger.type === "webhook") {
    if (!matchesFilters(input.rawPayload, trigger.filters)) {
      // mark processed; return ignored (filtered out)
    } else {
      const inputs = applyWebhookMapping(input.rawPayload, trigger.inputsMapping);
      const res = await runAgent({ orchestrator: c.orchestrator }, agent, inputs, "webhook",
        { userId: null, orgId: agent.orgId });
      // mark event resolved with res.workflowInstanceId
      return { status: "resolved", matched: 1, eventId: event.id };
    }
  }
}
```

Reuse the existing **delivery-id dedup** (the event-row unique index) unchanged — duplicate deliveries are ignored before this branch.

- [ ] **Step 3: Typecheck + a focused ingest test** (mock `c.webhooks.getByTenantToken` returning a webhook with `agentId`, assert `runAgent` is invoked with mapped inputs). 

> This is the one change to shared ingest code — keep the agent branch additive and guarded by `webhook.agentId` so existing workflow-webhook behaviour is untouched.

---

## Task 5: Schedule trigger — durable scheduler tick

**Files:** Create `packages/orchestrator/src/scheduler/agent-scheduler.ts` + test; modify `cli-worker.ts`; add `cron-parser` to `packages/orchestrator/package.json`.

- [ ] **Step 1: Add the dep** — `cron-parser` (parses cron + computes next run in a timezone). `npm install`.

- [ ] **Step 2: Schedule-state sync** — when an agent with a schedule trigger is enabled (Task 6 / readiness), upsert `jm_agent_schedule_state` with `cron`, `timezone`, and `next_due_at = nextRun(cron, tz)`. On disable/delete, the row is removed (FK cascade on delete; explicit delete on disable).

- [ ] **Step 3: The tick** — `agent-scheduler.ts`:

```typescript
import parser from "cron-parser";
import type { Pool } from "pg";
import { getAgent } from "@journeyman/agents";
import { runAgent } from "@journeyman/agents";

export function nextRun(cron: string, timezone: string, from = new Date()): Date {
  return parser.parseExpression(cron, { tz: timezone, currentDate: from }).next().toDate();
}

export async function tickOnce(pool: Pool, orchestrator: { submit: any }): Promise<number> {
  // Atomically claim due schedules so multiple workers don't double-fire.
  const { rows } = await pool.query(
    `UPDATE jm_agent_schedule_state s
        SET last_fired_at = now(), updated_at = now()
      WHERE s.next_due_at <= now()
      RETURNING s.agent_id, s.cron, s.timezone`,
  );
  let fired = 0;
  for (const r of rows) {
    const agent = await getAgent(pool, r.agent_id);
    if (agent && agent.enabled) {
      const schedule = agent.triggers.find((t: any) => t.type === "schedule");
      const inputs = (schedule && "fixedInputs" in schedule ? schedule.fixedInputs : {}) ?? {};
      try { await runAgent({ orchestrator }, agent, inputs as Record<string, unknown>, "schedule", { userId: null, orgId: agent.orgId }); fired++; }
      catch { /* log; skip */ }
    }
    // compute next due (skip missed — fire next upcoming)
    await pool.query(`UPDATE jm_agent_schedule_state SET next_due_at = $2 WHERE agent_id = $1`,
      [r.agent_id, nextRun(r.cron, r.timezone)]);
  }
  return fired;
}

export function startAgentScheduler(pool: Pool, orchestrator: { submit: any }, intervalMs = 60_000): () => void {
  const h = setInterval(() => { void tickOnce(pool, orchestrator).catch(() => {}); }, intervalMs);
  return () => clearInterval(h);
}
```

The `UPDATE ... WHERE next_due_at <= now() RETURNING` is the **single-fire claim** (atomic; safe across workers). Policy: skip missed fires (next_due recomputed forward).

- [ ] **Step 4: Test** `nextRun` + `tickOnce` with a fake pool returning a due row; assert `runAgent`/submit called once and `next_due_at` advanced.

- [ ] **Step 5: Start it** — in `cli-worker.ts`, after the pool + orchestrator are constructed, `if (pool) startAgentScheduler(pool, orchestrator);`. (Confirm an `orchestrator` with `.submit` is available in the worker process; if the worker doesn't already hold one, construct the same `ConductorOrchestrator` the api-server uses, or run the scheduler in the api-server process instead — pick whichever process owns `submit`.)

> **Implementer decision:** the scheduler must run in a process that has `orchestrator.submit`. If that's the api-server (not the worker), start it there in `server.ts` instead. Verify which process holds the orchestrator before wiring.

---

## Task 6: Enable-readiness + reveal wiring

**Files:** Modify `packages/agents/src/readiness.ts`, `packages/api-server/src/routes/agents.ts` (enable hook), `EditAgentModal.tsx`.

- [ ] **Step 1: Validate triggers at enable** — extend `checkReadiness`: each `webhook` trigger has a `webhookId` + `inputsMapping`; each `schedule` has a valid `cron` + `timezone` (parseable). (Required-input satisfiability for schedule already exists.)

- [ ] **Step 2: On enable, sync schedule state** — in the enable route, after marking active+enabled, for each schedule trigger upsert `jm_agent_schedule_state`; on disable, delete those rows.

- [ ] **Step 3: UI Triggers tab + reveal** — in `EditAgentModal.tsx`, add a **Triggers** tab: multi-select Webhook/Schedule/API; per selected trigger show its config (webhook: preset + auth + filter rows + mapping rows; schedule: cron + timezone; API: issue-token button). On provisioning (webhook create / api-token issue) show the **reveal** (URL + secret / token) once. Use `agentsApi` additions for the new trigger endpoints.

---

## Final verification
- [ ] `npm run typecheck` → exit 0; `npm run check:boundaries` → clean.
- [ ] `npm --workspace @journeyman/agents test` + the new orchestrator scheduler test + ingest test → PASS.
- [ ] **E2E:** issue an API token → `curl -H "Authorization: Bearer <tok>" -H "Idempotency-Key: k1" .../agents/:id/fire` twice → one run, second deduped. Configure a webhook trigger → POST a sample Jira payload to the inbound URL → filtered + mapped → run fires. Set a `* * * * *` schedule → enable → the tick fires it within a minute.
- [ ] **Commit** (one, at the end): `feat(agents): Phase 3 — API/webhook/schedule triggers + reveal + idempotency`.

## Scope / deferrals
- **Manual replay**, per-key concurrency lock (§15.1 #4), and the org-wide "all agent runs" view are not in Phase 3.
- The scheduler is **interval-poll + atomic claim** (good to ~1-minute granularity, multi-worker safe). Sub-minute cron and missed-fire catch-up are out of scope.
- Webhook auth types (hmac/token/none) reuse the webhook record's existing auth config — the agent trigger just selects/sets it at provisioning.
