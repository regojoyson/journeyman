# Agent Triggers UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw cron/text inputs in `TriggersSection` with a polished UI for Schedule (frequency pills), API (multi-token management), and Webhook (picker + event filter + input mapping) triggers.

**Architecture:** Backend gets one DB column (`disabled_at`), one new PATCH route, two guard checks in existing routes, and a `listensFor` array on the webhook trigger type. Frontend gets a cron-builder utility (TDD), three sub-components, and a rewritten `TriggersSection`. Flow-editor's `ListensForPicker` and `AcceptIfBuilder` are copied into `packages/web/src/lib/` (both packages are in the `ui` layer — import is legal) with their required CSS rules added to `web/src/styles.css`.

**Tech Stack:** TypeScript, React, Tailwind v4/shadcn zinc, PostgreSQL, Fastify, Vitest (existing test runner in both `web` and `api-server` packages).

---

## File Map

| File | Action |
|------|--------|
| `packages/migrations/src/sql/059_agent_token_disabled_at.sql` | **Create** — `disabled_at` column |
| `packages/core/src/types/agent.types.ts` | **Modify** — `listensFor` on webhook trigger; simplify api trigger type |
| `packages/api-server/src/routes/agent-triggers.ts` | **Modify** — PATCH toggle route; list tokens includes `disabled_at`; `/fire` checks disabled + api trigger |
| `packages/api-server/src/services/agent-webhook-fire.ts` | **Modify** — add `eventType` param; check `listensFor` |
| `packages/api-server/src/services/agent-webhook-fire.test.ts` | **Modify** — add `listensFor` test cases |
| `packages/api-server/src/services/webhook-ingest.ts` | **Modify** — pass `eventType` to `fireAgentForWebhook` |
| `packages/web/src/lib/cron-builder.ts` | **Create** — `toCron`, `fromCron`, `summarizeCron` |
| `packages/web/src/lib/cron-builder.test.ts` | **Create** — TDD tests |
| `packages/web/src/lib/pathsFromSchema.ts` | **Create** — extracted from flow-editor |
| `packages/web/src/lib/ListensForPicker.tsx` | **Create** — copied from flow-editor |
| `packages/web/src/lib/AcceptIfBuilder.logic.ts` | **Create** — copied from flow-editor |
| `packages/web/src/lib/AcceptIfBuilder.tsx` | **Create** — copied from flow-editor |
| `packages/web/src/lib/useWorkspaceWebhooks.ts` | **Create** — workspace-scoped webhook hook |
| `packages/web/src/styles.css` | **Modify** — add AcceptIfBuilder CSS rules |
| `packages/web/src/api/agents.ts` | **Modify** — `disableApiToken`, `enableApiToken`; updated token list type |
| `packages/web/src/components/agents/sections/ScheduleTrigger.tsx` | **Create** |
| `packages/web/src/components/agents/sections/ApiTrigger.tsx` | **Create** |
| `packages/web/src/components/agents/sections/WebhookTrigger.tsx` | **Create** |
| `packages/web/src/components/agents/sections/TriggersSection.tsx` | **Rewrite** |

---

## Task 1: DB Migration — `disabled_at` on `jm_agent_api_tokens`

**Files:**
- Create: `packages/migrations/src/sql/059_agent_token_disabled_at.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 059_agent_token_disabled_at.sql
ALTER TABLE jm_agent_api_tokens ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
```

- [ ] **Step 2: Apply the migration**

```bash
npm run migrate
```

Expected: prints `Applied 059_agent_token_disabled_at.sql` (or "already applied" if re-run).

- [ ] **Step 3: Commit**

```bash
git add packages/migrations/src/sql/059_agent_token_disabled_at.sql
git commit -m "feat(migrations): add disabled_at to jm_agent_api_tokens"
```

---

## Task 2: Core Types — `listensFor` + simplify API trigger type

**Files:**
- Modify: `packages/core/src/types/agent.types.ts`

- [ ] **Step 1: Update the `AgentTrigger` union**

Replace the existing type definition at lines 62–72:

```typescript
/** Phase 1 fires only "manual"; webhook/api/schedule modeled for later phases. */
export type AgentTrigger =
  | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> }
  | { type: "api" }
  | {
      type: "webhook";
      webhookId: string;
      listensFor?: string[];
      filters?: unknown;
      inputsMapping: Record<string, string>;
    };
```

(Removes the unused `tokenHash` field from the `api` variant; adds `listensFor` to the `webhook` variant. The `preset` and `event` fields on the webhook variant were vestigial — dropping them too.)

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: 0 errors. If any downstream code references `.tokenHash` on an api trigger, fix it by removing those references (there should be none — grep confirms `tokenHash` was only in the type definition).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/agent.types.ts
git commit -m "feat(core): add listensFor to webhook trigger; simplify api trigger type"
```

---

## Task 3: Backend Routes — Token Disable/Enable, Fire Guard

**Files:**
- Modify: `packages/api-server/src/routes/agent-triggers.ts`

- [ ] **Step 1: Update the list-tokens query to include `disabled_at` and revoked tokens**

Replace the `app.get` handler body (the SQL query line):

```typescript
const { rows } = await pool.query(
  `SELECT id, name, last_used_at, created_at, disabled_at, revoked_at
    FROM jm_agent_api_tokens
    WHERE agent_id = $1
    ORDER BY created_at DESC`,
  [id],
);
```

(Removed `revoked_at IS NULL` filter so revoked tokens appear as an audit trail; added `disabled_at` and `revoked_at` to SELECT.)

- [ ] **Step 2: Add PATCH route for enable/disable**

Insert this route after the `app.delete` handler (before the closing of `registerAgentTriggerRoutes`):

```typescript
// Enable or disable a token (soft toggle — does not affect last_used_at).
app.patch("/api/workspaces/:wsId/agents/:id/triggers/api-token/:tokenId", write, async (req, reply) => {
  const { wsId, id, tokenId } = req.params as { wsId: string; id: string; tokenId: string };
  const body = req.body as { disabled: boolean } | undefined;
  if (typeof body?.disabled !== "boolean") {
    reply.code(400).send({ error: "body must be { disabled: boolean }" });
    return;
  }
  const agent = await getAgent(pool, id);
  if (!agent || agent.workspaceId !== wsId) {
    reply.code(404).send({ error: "not_found" });
    return;
  }
  await pool.query(
    `UPDATE jm_agent_api_tokens
      SET disabled_at = CASE WHEN $1 THEN now() ELSE NULL END
      WHERE id = $2 AND agent_id = $3 AND revoked_at IS NULL`,
    [body.disabled, tokenId, id],
  );
  reply.code(204);
});
```

- [ ] **Step 3: Update the `/fire` route to check `disabled_at` and API trigger presence**

Replace the token lookup query (currently selects `id` from `jm_agent_api_tokens`):

```typescript
const tok = await pool.query(
  `SELECT id FROM jm_agent_api_tokens
    WHERE agent_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND disabled_at IS NULL`,
  [id, hashToken(bearer)],
);
if (!tok.rows[0]) {
  reply.code(401);
  return { error: "invalid_token" };
}
void pool.query(`UPDATE jm_agent_api_tokens SET last_used_at = now() WHERE id = $1`, [tok.rows[0].id]).catch(() => {});

const agent = await getAgent(pool, id);
if (!agent) {
  reply.code(404);
  return { error: "not_found" };
}

// Check that the API trigger is enabled (toggle = presence of { type: "api" } in triggers).
const apiTriggerEnabled = agent.triggers.some((t) => t.type === "api");
if (!apiTriggerEnabled) {
  reply.code(403);
  return { error: "api_trigger_disabled" };
}

if (!agent.enabled) {
  reply.code(202);
  return { status: "skipped_disabled" };
}
```

- [ ] **Step 4: Type-check and run tests**

```bash
npm run typecheck && npm test --workspace=packages/api-server
```

Expected: 0 errors, no new failures.

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/routes/agent-triggers.ts
git commit -m "feat(api): token disable/enable PATCH route; fire checks disabled_at + api trigger"
```

---

## Task 4: Backend — `listensFor` Check in Webhook Fire

**Files:**
- Modify: `packages/api-server/src/services/agent-webhook-fire.ts`
- Modify: `packages/api-server/src/services/agent-webhook-fire.test.ts`
- Modify: `packages/api-server/src/services/webhook-ingest.ts`

- [ ] **Step 1: Write failing tests for `listensFor`**

Add these three test cases to the `describe("fireAgentForWebhook")` block in `agent-webhook-fire.test.ts`:

```typescript
it("skips (filtered) when listensFor excludes the inbound event type", async () => {
  findAgentMock.mockResolvedValueOnce({
    orgId: "o1",
    triggers: [{ type: "webhook", webhookId: "wh1", listensFor: ["push"], inputsMapping: {} }],
  });
  const res = await fireAgentForWebhook(comp(), {
    webhookId: "wh1", rawPayload: {}, eventType: "pull_request",
  });
  expect(res).toEqual({ fired: 0, skipped: "filtered" });
  expect(runAgentMock).not.toHaveBeenCalled();
});

it("fires when listensFor includes the inbound event type", async () => {
  findAgentMock.mockResolvedValueOnce({
    orgId: "o1",
    triggers: [{ type: "webhook", webhookId: "wh1", listensFor: ["push"], inputsMapping: {} }],
  });
  const res = await fireAgentForWebhook(comp(), {
    webhookId: "wh1", rawPayload: {}, eventType: "push",
  });
  expect(res.fired).toBe(1);
});

it("fires for any event type when listensFor is empty", async () => {
  findAgentMock.mockResolvedValueOnce({
    orgId: "o1",
    triggers: [{ type: "webhook", webhookId: "wh1", listensFor: [], inputsMapping: {} }],
  });
  const res = await fireAgentForWebhook(comp(), {
    webhookId: "wh1", rawPayload: {}, eventType: "any_event",
  });
  expect(res.fired).toBe(1);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test --workspace=packages/api-server
```

Expected: 3 new failures — `eventType` is not part of `FireAgentInput` yet, and `listensFor` is not checked.

- [ ] **Step 3: Update `FireAgentInput` and add `listensFor` guard**

Replace the full contents of `packages/api-server/src/services/agent-webhook-fire.ts`:

```typescript
import type { Composition } from "../composition.ts";
import type { AgentSkipReason } from "@journeyman/core";
import { readPath } from "@journeyman/webhooks";
import { findAgentByWebhookId, runAgentGuarded, wasSkipped } from "@journeyman/agents";

export interface FireAgentInput {
  webhookId: string;
  rawPayload: unknown;
  /** Event type extracted from the inbound payload (e.g. "push", "pull_request"). */
  eventType?: string | null;
}

export interface FireAgentResult {
  fired: number;
  /** "filtered" → event filtered out; a safety reason → a rail tripped. Both = ignored. */
  skipped?: "filtered" | AgentSkipReason;
  workflowInstanceId?: string;
}

/**
 * If an enabled agent's webhook trigger references this webhook, evaluate its
 * filter, map the payload to the agent's inputs, and fire a run. Returns
 * { fired: 0 } when no agent uses the webhook (so the caller falls through to
 * workflow triggers — existing behaviour is untouched).
 */
export async function fireAgentForWebhook(c: Composition, input: FireAgentInput): Promise<FireAgentResult> {
  if (!c.pool) return { fired: 0 };
  const agent = await findAgentByWebhookId(c.pool, input.webhookId);
  if (!agent) return { fired: 0 };
  const trigger = agent.triggers.find((t) => t.type === "webhook" && t.webhookId === input.webhookId) as
    | Extract<(typeof agent.triggers)[number], { type: "webhook" }>
    | undefined;
  if (!trigger) return { fired: 0 };

  // listensFor filter: if the trigger specifies event types, the inbound event must be in the list.
  if (trigger.listensFor && trigger.listensFor.length > 0 && input.eventType) {
    if (!trigger.listensFor.includes(input.eventType)) {
      return { fired: 0, skipped: "filtered" };
    }
  }

  if (
    trigger.filters &&
    c.conditions.evaluate(trigger.filters, (input.rawPayload ?? {}) as Record<string, unknown>) !== true
  ) {
    return { fired: 0, skipped: "filtered" };
  }

  const inputs: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(trigger.inputsMapping ?? {})) {
    inputs[name] = readPath(input.rawPayload, path);
  }

  const res = await runAgentGuarded(
    { orchestrator: c.orchestrator, pool: c.pool },
    agent,
    inputs,
    "webhook",
    { userId: null, orgId: agent.orgId },
    "trigger-1",
    { payload: input.rawPayload },
  );
  if (wasSkipped(res)) return { fired: 0, skipped: res.skipped };
  return { fired: 1, workflowInstanceId: res.workflowInstanceId };
}
```

- [ ] **Step 4: Pass `eventType` from webhook-ingest.ts**

In `packages/api-server/src/services/webhook-ingest.ts`, find the call to `fireAgentForWebhook` (around line 150) and add `eventType`:

```typescript
const ar = await fireAgentForWebhook(c, { webhookId: webhook.id, rawPayload: input.rawPayload, eventType });
```

(`eventType` is already computed at line 82 in that file — just thread it through.)

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npm test --workspace=packages/api-server
```

Expected: all 3 new tests pass, no existing tests broken.

- [ ] **Step 6: Commit**

```bash
git add packages/api-server/src/services/agent-webhook-fire.ts \
        packages/api-server/src/services/agent-webhook-fire.test.ts \
        packages/api-server/src/services/webhook-ingest.ts
git commit -m "feat(api): listensFor event filter in webhook agent fire"
```

---

## Task 5: Cron Builder Utility — TDD

**Files:**
- Create: `packages/web/src/lib/cron-builder.ts`
- Create: `packages/web/src/lib/cron-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/web/src/lib/cron-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toCron, fromCron, summarizeCron, DEFAULT_SCHEDULE } from "./cron-builder.ts";

describe("toCron", () => {
  it("hourly → '0 * * * *'", () => {
    expect(toCron({ frequency: "hourly", time: "09:00", days: [], dom: 1 })).toBe("0 * * * *");
  });
  it("daily at 09:30 → '30 9 * * *'", () => {
    expect(toCron({ frequency: "daily", time: "09:30", days: [], dom: 1 })).toBe("30 9 * * *");
  });
  it("weekly Mon+Fri at 09:00 → '0 9 * * 1,5'", () => {
    expect(toCron({ frequency: "weekly", time: "09:00", days: [1, 5], dom: 1 })).toBe("0 9 * * 1,5");
  });
  it("weekly with no days selected → '0 9 * * *'", () => {
    expect(toCron({ frequency: "weekly", time: "09:00", days: [], dom: 1 })).toBe("0 9 * * *");
  });
  it("monthly 15th at 09:00 → '0 9 15 * *'", () => {
    expect(toCron({ frequency: "monthly", time: "09:00", days: [], dom: 15 })).toBe("0 9 15 * *");
  });
  it("monthly last day → '0 9 28 * *'", () => {
    expect(toCron({ frequency: "monthly", time: "09:00", days: [], dom: 28 })).toBe("0 9 28 * *");
  });
});

describe("fromCron", () => {
  it("parses hourly", () => {
    expect(fromCron("0 * * * *")).toEqual({ frequency: "hourly", time: "00:00", days: [], dom: 1 });
  });
  it("parses daily", () => {
    expect(fromCron("30 9 * * *")).toEqual({ frequency: "daily", time: "09:30", days: [], dom: 1 });
  });
  it("parses weekly", () => {
    expect(fromCron("0 9 * * 1,5")).toEqual({ frequency: "weekly", time: "09:00", days: [1, 5], dom: 1 });
  });
  it("parses monthly", () => {
    expect(fromCron("0 9 15 * *")).toEqual({ frequency: "monthly", time: "09:00", days: [], dom: 15 });
  });
  it("returns null for unrecognised patterns", () => {
    expect(fromCron("*/5 * * * *")).toBeNull();
    expect(fromCron("0 9 1,15 * *")).toBeNull(); // two dom values — not friendly
    expect(fromCron("0 9 * 3 *")).toBeNull();     // month != *
    expect(fromCron("0 9 * * 1-5")).toBeNull();   // range expression
  });
  it("roundtrips through toCron", () => {
    const s = { frequency: "weekly" as const, time: "14:00", days: [1, 3, 5], dom: 1 };
    expect(fromCron(toCron(s))).toEqual(s);
  });
});

describe("summarizeCron", () => {
  it("hourly", () => {
    expect(summarizeCron({ frequency: "hourly", time: "00:00", days: [], dom: 1 }, "UTC")).toBe("Every hour · UTC");
  });
  it("daily", () => {
    expect(summarizeCron({ frequency: "daily", time: "09:30", days: [], dom: 1 }, "America/New_York")).toBe(
      "Every day at 09:30 · New_York",
    );
  });
  it("weekly with days", () => {
    expect(
      summarizeCron({ frequency: "weekly", time: "09:00", days: [1, 5], dom: 1 }, "UTC"),
    ).toBe("Every week on Mon, Fri at 09:00 · UTC");
  });
  it("weekly with no days selected", () => {
    expect(summarizeCron({ frequency: "weekly", time: "09:00", days: [], dom: 1 }, "UTC")).toBe(
      "Every week on every day at 09:00 · UTC",
    );
  });
  it("monthly", () => {
    expect(summarizeCron({ frequency: "monthly", time: "09:00", days: [], dom: 15 }, "UTC")).toBe(
      "Every month on the 15th at 09:00 · UTC",
    );
  });
  it("monthly last day", () => {
    expect(summarizeCron({ frequency: "monthly", time: "09:00", days: [], dom: 28 }, "UTC")).toBe(
      "Every month on the last day at 09:00 · UTC",
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test --workspace=packages/web
```

Expected: import errors for missing `cron-builder.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/web/src/lib/cron-builder.ts`:

```typescript
export type Frequency = "hourly" | "daily" | "weekly" | "monthly";

export interface ScheduleState {
  frequency: Frequency;
  /** "HH:MM" in 24-hour format. Unused for "hourly". */
  time: string;
  /** Day-of-week indices (0=Sun…6=Sat). Used for "weekly". */
  days: number[];
  /** Day-of-month (1–27 exact; 28 = last day). Used for "monthly". */
  dom: number;
}

export const DEFAULT_SCHEDULE: ScheduleState = {
  frequency: "daily",
  time: "09:00",
  days: [],
  dom: 1,
};

export function toCron(s: ScheduleState): string {
  const [hStr, mStr] = s.time.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  switch (s.frequency) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${s.days.length === 0 ? "*" : s.days.join(",")}`;
    case "monthly":
      return `${m} ${h} ${s.dom} * *`;
  }
}

export function fromCron(cron: string): ScheduleState | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  if (month !== "*") return null;

  // Hourly: "0 * * * *"
  if (minute === "0" && hour === "*" && dom === "*" && dow === "*") {
    return { frequency: "hourly", time: "00:00", days: [], dom: 1 };
  }

  // Minute and hour must be plain integers for all other frequencies.
  const m = parseInt(minute, 10);
  const h = parseInt(hour, 10);
  if (isNaN(m) || isNaN(h) || m < 0 || m > 59 || h < 0 || h > 23) return null;
  if (String(m) !== minute || String(h) !== hour) return null; // reject */n, ranges
  const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  // Daily: "m h * * *"
  if (dom === "*" && dow === "*") {
    return { frequency: "daily", time, days: [], dom: 1 };
  }

  // Weekly: "m h * * dow[,dow…]" — reject ranges and wildcards in dow
  if (dom === "*" && dow !== "*") {
    if (dow.includes("-") || dow.includes("/")) return null;
    const days = dow.split(",").map(Number);
    if (days.some((d) => isNaN(d) || d < 0 || d > 6)) return null;
    return { frequency: "weekly", time, days: days.sort((a, b) => a - b), dom: 1 };
  }

  // Monthly: "m h dom * *" — single integer dom only
  if (dom !== "*" && dow === "*") {
    if (dom.includes("-") || dom.includes("/") || dom.includes(",")) return null;
    const d = parseInt(dom, 10);
    if (isNaN(d) || d < 1 || d > 28) return null;
    return { frequency: "monthly", time, days: [], dom: d };
  }

  return null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinalSuffix(n: number): string {
  if (n === 28) return "last day";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function summarizeCron(state: ScheduleState, timezone: string): string {
  const tzLabel = timezone ? ` · ${timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone}` : "";
  switch (state.frequency) {
    case "hourly":
      return `Every hour${tzLabel}`;
    case "daily":
      return `Every day at ${state.time}${tzLabel}`;
    case "weekly": {
      const dayStr =
        state.days.length === 0 ? "every day" : state.days.map((d) => DAY_NAMES[d]).join(", ");
      return `Every week on ${dayStr} at ${state.time}${tzLabel}`;
    }
    case "monthly":
      return `Every month on the ${ordinalSuffix(state.dom)} at ${state.time}${tzLabel}`;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test --workspace=packages/web
```

Expected: all cron-builder tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/cron-builder.ts packages/web/src/lib/cron-builder.test.ts
git commit -m "feat(web): cron-builder utility — toCron, fromCron, summarizeCron"
```

---

## Task 6: Frontend API Layer Updates

**Files:**
- Modify: `packages/web/src/api/agents.ts`

- [ ] **Step 1: Update the `listApiTokens` return type and add disable/enable calls**

Replace the `listApiTokens`, `issueApiToken`, and `revokeApiToken` entries in `agentsApi`, and add the two new calls. Update the section from line 88 onwards:

```typescript
export interface ApiToken {
  id: string;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  disabled_at: string | null;
  revoked_at: string | null;
}
```

Add the `ApiToken` interface above the `agentsApi` object (near the other interfaces at top of file), then update the relevant `agentsApi` entries:

```typescript
  issueApiToken: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token`, { method: "POST", credentials: "include" }).then(
      jsonOrThrow<{ id: string; token: string }>,
    ),
  listApiTokens: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token`, { credentials: "include" }).then(
      jsonOrThrow<ApiToken[]>,
    ),
  revokeApiToken: (wsId: string, id: string, tokenId: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token/${tokenId}`, { method: "DELETE", credentials: "include" }).then(
      jsonOrThrow<void>,
    ),
  disableApiToken: (wsId: string, id: string, tokenId: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token/${tokenId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: true }),
    }).then(jsonOrThrow<void>),
  enableApiToken: (wsId: string, id: string, tokenId: string) =>
    fetch(`${wsBase(wsId)}/${id}/triggers/api-token/${tokenId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: false }),
    }).then(jsonOrThrow<void>),
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck --workspace=packages/web
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/agents.ts
git commit -m "feat(web/api): token disable/enable calls; updated ApiToken type"
```

---

## Task 7: Copy Flow-Editor Components + CSS

**Files:**
- Create: `packages/web/src/lib/pathsFromSchema.ts`
- Create: `packages/web/src/lib/AcceptIfBuilder.logic.ts`
- Create: `packages/web/src/lib/ListensForPicker.tsx`
- Create: `packages/web/src/lib/AcceptIfBuilder.tsx`
- Modify: `packages/web/src/styles.css`

Both packages are in the `ui` import layer (confirmed in `scripts/check-import-boundaries.mjs`), so cross-package imports are legal — but the components aren't exported from `@journeyman/flow-editor`'s index, so we copy instead of import.

- [ ] **Step 1: Copy `pathsFromSchema`**

Create `packages/web/src/lib/pathsFromSchema.ts`:

```typescript
/**
 * Walks a JSON Schema and produces dot-paths for payload-path autocomplete,
 * e.g. ["$.action", "$.issue.number", "$.repository.full_name"].
 * Stops at `maxDepth` to keep the suggestion list manageable.
 */
export function pathsFromSchema(schema: unknown, maxDepth = 4): string[] {
  if (!schema || typeof schema !== "object") return [];
  const out: string[] = [];
  walk(schema as Record<string, unknown>, "$", out, maxDepth);
  return out;
}

function walk(node: Record<string, unknown>, prefix: string, out: string[], depth: number): void {
  if (depth <= 0) return;
  const props = node["properties"];
  if (props && typeof props === "object") {
    for (const [k, child] of Object.entries(props as Record<string, unknown>)) {
      const path = `${prefix}.${k}`;
      out.push(path);
      if (child && typeof child === "object") {
        walk(child as Record<string, unknown>, path, out, depth - 1);
      }
    }
  }
}
```

- [ ] **Step 2: Copy `AcceptIfBuilder.logic.ts`**

Create `packages/web/src/lib/AcceptIfBuilder.logic.ts` — copy verbatim from `packages/flow-editor/src/properties-panel/AcceptIfBuilder.logic.ts` (no changes needed; it has no imports).

- [ ] **Step 3: Copy `ListensForPicker.tsx`**

Create `packages/web/src/lib/ListensForPicker.tsx` — copy verbatim from `packages/flow-editor/src/properties-panel/ListensForPicker.tsx`. The component uses `--color-info`, `--color-text-subtle`, `--color-surface` CSS variables which are all available via the shared theme package (defined in `packages/theme/src/tokens.css` as legacy aliases for the shadcn tokens).

- [ ] **Step 4: Copy `AcceptIfBuilder.tsx`**

Create `packages/web/src/lib/AcceptIfBuilder.tsx` — copy from `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx`, but change the import path:

```typescript
// Change this line:
import { ... } from "./AcceptIfBuilder.logic.ts";
// To:
import { ... } from "./AcceptIfBuilder.logic.ts";
```

(The import path stays the same since both files are now in `packages/web/src/lib/`.)

- [ ] **Step 5: Add AcceptIfBuilder CSS to web styles**

Append to `packages/web/src/styles.css`:

```css
/* AcceptIfBuilder — copied from packages/flow-editor/src/styles.css */
.je-acceptif { display: flex; flex-direction: column; gap: 8px; }
.je-acceptif__header { display: flex; justify-content: flex-end; }
.je-acceptif__mode { display: inline-flex; border: 1px solid rgb(var(--color-border) / 1); border-radius: 4px; overflow: hidden; }
.je-acceptif__modebtn {
  background: transparent;
  border: none;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  color: rgb(var(--color-text-muted) / 1);
}
.je-acceptif__modebtn--on { background: rgb(var(--color-surface-raised) / 1); color: rgb(var(--color-text) / 1); }
.je-acceptif__modebtn[disabled] { opacity: 0.5; cursor: not-allowed; }
.je-acceptif__combinator { color: rgb(var(--color-text) / 1); font-size: 12px; display: flex; align-items: center; }
.je-acceptif__combinator select { width: auto; padding: 2px 6px; }
.je-acceptif__rule {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  padding: 6px 8px;
  border: 1px solid rgb(var(--color-border) / 1);
  border-radius: 6px;
}
.je-acceptif__rule--invalid { border-color: rgb(var(--color-danger) / 1); }
.je-acceptif__rule > input[type="text"],
.je-acceptif__rule > select {
  background: rgb(var(--color-surface) / 1);
  border: 1px solid rgb(var(--color-border) / 1);
  border-radius: 4px;
  color: rgb(var(--color-text) / 1);
  padding: 3px 6px;
  font-size: 12px;
}
.je-acceptif__rule-err { color: rgb(var(--color-danger) / 1); font-size: 11px; flex-basis: 100%; }
.je-acceptif__advanced textarea {
  width: 100%; min-height: 100px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px;
  background: rgb(var(--color-surface) / 1);
  border: 1px solid rgb(var(--color-border) / 1);
  border-radius: 4px;
  color: rgb(var(--color-text) / 1);
  padding: 6px;
}
.je-humantask__empty { color: rgb(var(--color-text-muted) / 1); font-size: 12px; padding: 2px 4px; }
.je-humantask__btn {
  font-size: 12px; padding: 4px 10px;
  background: transparent; border: 1px solid rgb(var(--color-border) / 1);
  border-radius: 5px; cursor: pointer; color: rgb(var(--color-text-muted) / 1);
}
.je-humantask__btn:hover { border-color: rgb(var(--color-border-strong) / 1); color: rgb(var(--color-text) / 1); }
.je-humantask__chip-x {
  border: none; background: transparent; cursor: pointer;
  color: rgb(var(--color-text-muted) / 1); padding: 0; font-size: 14px; line-height: 1;
}
.je-humantask__chip-x:hover { color: rgb(var(--color-danger) / 1); }
.je-hint--error { color: rgb(var(--color-danger) / 1); font-size: 11px; margin-top: 4px; }
```

- [ ] **Step 6: Type-check**

```bash
npm run typecheck --workspace=packages/web
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/pathsFromSchema.ts \
        packages/web/src/lib/AcceptIfBuilder.logic.ts \
        packages/web/src/lib/ListensForPicker.tsx \
        packages/web/src/lib/AcceptIfBuilder.tsx \
        packages/web/src/styles.css
git commit -m "feat(web): copy ListensForPicker + AcceptIfBuilder from flow-editor"
```

---

## Task 8: `ScheduleTrigger` Sub-Component

**Files:**
- Create: `packages/web/src/components/agents/sections/ScheduleTrigger.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/agents/sections/ScheduleTrigger.tsx`:

```typescript
import { useState } from "react";
import type { AgentInputField } from "@journeyman/core";
import { toCron, fromCron, summarizeCron, DEFAULT_SCHEDULE, type ScheduleState } from "../../../lib/cron-builder.ts";
import { inputCls } from "../../../routes/admin-styles.ts";

interface ScheduleTriggerProps {
  cron: string;
  timezone: string;
  fixedInputs: Record<string, string>;
  inputs: AgentInputField[];
  locked: boolean;
  onChange: (cron: string, timezone: string, fixedInputs: Record<string, string>) => void;
}

const TIMEZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Anchorage", "America/Honolulu",
  "America/Sao_Paulo", "America/Toronto", "America/Vancouver",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam",
  "Europe/Moscow", "Europe/Istanbul",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Sydney", "Pacific/Auckland",
];

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function ScheduleTrigger({ cron, timezone, fixedInputs, inputs, locked, onChange }: ScheduleTriggerProps) {
  const [state, setState] = useState<ScheduleState>(() => fromCron(cron) ?? DEFAULT_SCHEDULE);
  const [advancedCron, setAdvancedCron] = useState(cron);
  const [showAdvanced, setShowAdvanced] = useState(() => fromCron(cron) === null && cron !== "");
  const [tz, setTz] = useState(() => timezone || detectTimezone());

  const emit = (nextState: ScheduleState, nextTz: string, nextFixed: Record<string, string>) => {
    onChange(showAdvanced ? advancedCron : toCron(nextState), nextTz, nextFixed);
  };

  const updateState = (next: ScheduleState) => {
    setState(next);
    onChange(toCron(next), tz, fixedInputs);
  };

  const updateTz = (nextTz: string) => {
    setTz(nextTz);
    onChange(showAdvanced ? advancedCron : toCron(state), nextTz, fixedInputs);
  };

  const handleAdvanced = (val: string) => {
    setAdvancedCron(val);
    onChange(val, tz, fixedInputs);
    const parsed = fromCron(val);
    if (parsed) setState(parsed);
  };

  const preview = showAdvanced ? advancedCron : summarizeCron(state, tz);

  return (
    <div className="space-y-4">
      {/* Frequency pills */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Frequency</div>
        <div className="flex gap-2">
          {(["hourly", "daily", "weekly", "monthly"] as const).map((f) => (
            <button
              key={f}
              type="button"
              disabled={locked}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                state.frequency === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-ring"
              }`}
              onClick={() => updateState({ ...state, frequency: f })}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Day-of-week circles (weekly only) */}
      {state.frequency === "weekly" && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">On</div>
          <div className="flex gap-1.5">
            {DOW_LABELS.map((label, idx) => (
              <button
                key={idx}
                type="button"
                disabled={locked}
                className={`w-9 h-9 rounded-full text-xs border transition-colors ${
                  state.days.includes(idx)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-ring"
                }`}
                onClick={() => {
                  const days = state.days.includes(idx)
                    ? state.days.filter((d) => d !== idx)
                    : [...state.days, idx].sort((a, b) => a - b);
                  updateState({ ...state, days });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day-of-month dropdown (monthly only) */}
      {state.frequency === "monthly" && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">On the</div>
          <select
            className={inputCls + " w-40"}
            disabled={locked}
            value={state.dom}
            onChange={(e) => updateState({ ...state, dom: Number(e.target.value) })}
          >
            {Array.from({ length: 27 }, (_, i) => i + 1).map((d) => {
              const s = ["th", "st", "nd", "rd"];
              const v = d % 100;
              const ord = d + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
              return <option key={d} value={d}>{ord}</option>;
            })}
            <option value={28}>Last day</option>
          </select>
        </div>
      )}

      {/* Time picker (daily / weekly / monthly) */}
      {state.frequency !== "hourly" && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">At</div>
          <input
            type="time"
            className={inputCls + " w-36"}
            disabled={locked}
            value={state.time}
            onChange={(e) => updateState({ ...state, time: e.target.value })}
          />
        </div>
      )}

      {/* Timezone */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Timezone</div>
        <select className={inputCls} disabled={locked} value={tz} onChange={(e) => updateTz(e.target.value)}>
          {/* Show detected zone even if it's not in the list */}
          {!TIMEZONES.includes(tz) && <option value={tz}>{tz} (detected)</option>}
          {TIMEZONES.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
      </div>

      {/* Live preview */}
      <p className="text-xs text-muted-foreground italic">{preview}</p>

      {/* Advanced cron escape hatch */}
      {!showAdvanced ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => { setAdvancedCron(toCron(state)); setShowAdvanced(true); }}
        >
          Advanced: edit cron expression…
        </button>
      ) : (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Cron expression</div>
          <div className="flex gap-2 items-center">
            <input
              className={inputCls}
              disabled={locked}
              placeholder="0 9 * * 1-5"
              value={advancedCron}
              onChange={(e) => handleAdvanced(e.target.value)}
            />
            {fromCron(advancedCron) !== null && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline whitespace-nowrap"
                onClick={() => { setState(fromCron(advancedCron)!); setShowAdvanced(false); }}
              >
                ← Back to picker
              </button>
            )}
          </div>
        </div>
      )}

      {/* Activation note */}
      <p className="text-xs text-muted-foreground">Schedule activates when the agent is enabled.</p>

      {/* Fixed inputs */}
      {inputs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Fixed inputs</div>
          {inputs.map((inp) => (
            <div key={inp.name} className="flex items-center gap-2">
              <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
              <span className="text-muted-foreground">=</span>
              <input
                className={inputCls}
                disabled={locked}
                placeholder="fixed value"
                value={fixedInputs[inp.name] ?? ""}
                onChange={(e) => {
                  const next = { ...fixedInputs, [inp.name]: e.target.value };
                  if (!e.target.value) delete next[inp.name];
                  onChange(showAdvanced ? advancedCron : toCron(state), tz, next);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck --workspace=packages/web
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agents/sections/ScheduleTrigger.tsx
git commit -m "feat(web): ScheduleTrigger sub-component with frequency pills"
```

---

## Task 9: `ApiTrigger` Sub-Component

**Files:**
- Create: `packages/web/src/components/agents/sections/ApiTrigger.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/agents/sections/ApiTrigger.tsx`:

```typescript
import { useEffect, useState } from "react";
import type { AgentInputField } from "@journeyman/core";
import { agentsApi, type ApiToken } from "../../../api/agents.ts";

interface ApiTriggerProps {
  agentId: string;
  wsId: string;
  inputs: AgentInputField[];
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString();
}

export function ApiTrigger({ agentId, wsId, inputs }: ApiTriggerProps) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [revealedToken, setRevealedToken] = useState<{ id: string; plaintext: string } | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const [showCurl, setShowCurl] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);

  const endpoint = `/api/agents/${agentId}/fire`;
  const endpointFull = `${window.location.origin}${endpoint}`;

  const reload = () => agentsApi.listApiTokens(wsId, agentId).then(setTokens).catch(() => setTokens([]));
  useEffect(() => { void reload(); }, [wsId, agentId]);

  const issue = async () => {
    const r = await agentsApi.issueApiToken(wsId, agentId);
    setRevealedToken({ id: r.id, plaintext: r.token });
    await reload();
  };

  const curlBody = inputs.length > 0
    ? JSON.stringify(
        Object.fromEntries(
          inputs.map((inp) => [
            inp.name,
            inp.type === "number" ? 42 : inp.type === "boolean" ? true : `<${inp.name}>`,
          ]),
        ),
        null,
        2,
      )
    : null;

  const curlText = [
    `curl -X POST "${endpointFull}" \\`,
    `  -H "Authorization: Bearer <your-token>" \\`,
    `  -H "Content-Type: application/json"`,
    ...(curlBody ? [`  -d '${curlBody}'`] : []),
  ].join(" \\\n");

  const handleCopyCurl = () => {
    copyToClipboard(curlText);
    setCurlCopied(true);
    setTimeout(() => setCurlCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Endpoint row */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Endpoint</div>
        <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 font-mono text-xs">
          <span className="bg-foreground text-background text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">POST</span>
          <span className="flex-1 text-foreground truncate">{endpoint}</span>
          <button
            type="button"
            onClick={() => copyToClipboard(endpointFull)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Copy URL"
          >⎘</button>
        </div>
      </div>

      {/* One-time reveal banner */}
      {revealedToken && (
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3 space-y-2">
          <p className="text-xs font-medium text-emerald-400">✓ Token issued — copy it now, it won't be shown again</p>
          <div className="flex items-center gap-2 font-mono text-xs break-all">
            <span className="flex-1 text-foreground">{revealedToken.plaintext}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(revealedToken!.plaintext)}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
            >⎘</button>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setRevealedToken(null)}
          >I've saved it, dismiss</button>
        </div>
      )}

      {/* Tokens */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Tokens</div>
        <div className="space-y-1.5 mb-3">
          {tokens.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No tokens yet.</p>
          )}
          {tokens.map((tok) => {
            const isRevoked = tok.revoked_at !== null;
            const isDisabled = !isRevoked && tok.disabled_at !== null;
            return (
              <div
                key={tok.id}
                className={`flex items-center gap-3 bg-muted border border-border rounded-lg px-3 py-2.5 ${
                  isRevoked || isDisabled ? "opacity-55" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{tok.name || tok.id.slice(0, 8)}</span>
                    {isRevoked ? (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-border text-muted-foreground">Revoked</span>
                    ) : isDisabled ? (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-border text-muted-foreground">Disabled</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-400">Active</span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground mt-0.5">jm_agt_{tok.id.slice(0, 4)}••••••••••••</div>
                  <div className="text-[11px] text-muted-foreground">
                    Created {formatDate(tok.created_at)} · Last used {formatDate(tok.last_used_at)}
                  </div>
                </div>
                {!isRevoked && (
                  <div className="flex gap-1.5 flex-shrink-0">
                    {isDisabled ? (
                      <button
                        type="button"
                        className="text-[11px] border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
                        onClick={() => agentsApi.enableApiToken(wsId, agentId, tok.id).then(reload)}
                      >Enable</button>
                    ) : (
                      <button
                        type="button"
                        className="text-[11px] border border-border rounded px-2 py-1 text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
                        onClick={() => agentsApi.disableApiToken(wsId, agentId, tok.id).then(reload)}
                      >Disable</button>
                    )}
                    {revokeConfirm === tok.id ? (
                      <>
                        <button
                          type="button"
                          className="text-[11px] border border-destructive/40 rounded px-2 py-1 text-destructive hover:bg-destructive/10 transition-colors"
                          onClick={() => agentsApi.revokeApiToken(wsId, agentId, tok.id).then(() => { setRevokeConfirm(null); return reload(); })}
                        >Confirm</button>
                        <button
                          type="button"
                          className="text-[11px] border border-border rounded px-2 py-1 text-muted-foreground"
                          onClick={() => setRevokeConfirm(null)}
                        >Cancel</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="text-[11px] border border-border rounded px-2 py-1 text-destructive"
                        onClick={() => setRevokeConfirm(tok.id)}
                      >Revoke</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="flex items-center justify-center gap-1.5 w-full py-2 border border-dashed border-ring rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={issue}
        >＋ Issue new token</button>
      </div>

      {/* Curl usage example */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          className="flex items-center justify-between w-full px-3.5 py-2.5 bg-muted text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowCurl((v) => !v)}
        >
          <span className="flex items-center gap-2">
            📋 Usage example
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-950/40 text-blue-400">curl</span>
          </span>
          <span className="text-xs">{showCurl ? "▴" : "▾"}</span>
        </button>
        {showCurl && (
          <div className="p-3 bg-background border-t border-border space-y-3">
            {inputs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Pass your agent's inputs as JSON. This agent expects:{" "}
                {inputs.map((i) => <code key={i.name} className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">{i.name}</code>)}.
              </p>
            )}
            <div className="relative bg-background rounded-lg border border-border p-3">
              <button
                type="button"
                className={`absolute top-2 right-2 text-[11px] border rounded px-2 py-1 transition-colors ${
                  curlCopied
                    ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-400"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-ring"
                }`}
                onClick={handleCopyCurl}
              >{curlCopied ? "✓ Copied" : "⎘ Copy"}</button>
              <pre className="text-[12px] font-mono text-foreground whitespace-pre-wrap break-all pr-16">{curlText}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck --workspace=packages/web
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agents/sections/ApiTrigger.tsx
git commit -m "feat(web): ApiTrigger sub-component with token management + curl example"
```

---

## Task 10: `WebhookTrigger` Sub-Component + Workspace Webhook Hook

**Files:**
- Create: `packages/web/src/lib/useWorkspaceWebhooks.ts`
- Create: `packages/web/src/components/agents/sections/WebhookTrigger.tsx`

- [ ] **Step 1: Create `useWorkspaceWebhooks` hook**

Create `packages/web/src/lib/useWorkspaceWebhooks.ts`:

```typescript
import { useEffect, useState } from "react";
import type { Webhook } from "@journeyman/core";

export interface WsWebhook {
  id: string;
  name: string;
  preset: string;
  tenantToken: string;
  ingestUrl: string;
  knownEventTypes: string[];
  payloadSchema?: unknown;
}

export function useWorkspaceWebhooks(wsId: string): { webhooks: WsWebhook[]; loading: boolean } {
  const [webhooks, setWebhooks] = useState<WsWebhook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    Promise.all([
      fetch(`/api/workspaces/${wsId}/webhooks`, { credentials: "include", signal: ac.signal })
        .then((r) => (r.ok ? (r.json() as Promise<Webhook[]>) : []))
        .catch(() => [] as Webhook[]),
      fetch("/api/webhook-presets", { credentials: "include", signal: ac.signal })
        .then((r) =>
          r.ok ? (r.json() as Promise<Array<{ id: string; knownEventTypes: string[] }>>) : [],
        )
        .catch(() => []),
    ]).then(([list, presets]) => {
      if (cancelled) return;
      const presetById = new Map(presets.map((p) => [p.id, p]));
      setWebhooks(
        list.map((w) => ({
          id: w.id,
          name: w.name,
          preset: w.preset,
          tenantToken: w.tenantToken,
          ingestUrl: w.ingestUrl,
          knownEventTypes: presetById.get(w.preset)?.knownEventTypes ?? [],
          payloadSchema: w.payloadSchema,
        })),
      );
      setLoading(false);
    });
    return () => { cancelled = true; ac.abort(); };
  }, [wsId]);

  return { webhooks, loading };
}
```

- [ ] **Step 2: Create `WebhookTrigger` component**

Create `packages/web/src/components/agents/sections/WebhookTrigger.tsx`:

```typescript
import { useState } from "react";
import type { AgentInputField } from "@journeyman/core";
import { pathsFromSchema } from "../../../lib/pathsFromSchema.ts";
import { ListensForPicker } from "../../../lib/ListensForPicker.tsx";
import { AcceptIfBuilder } from "../../../lib/AcceptIfBuilder.tsx";
import { useWorkspaceWebhooks } from "../../../lib/useWorkspaceWebhooks.ts";
import { inputCls } from "../../../routes/admin-styles.ts";

export interface WebhookTriggerValue {
  webhookId: string;
  listensFor: string[];
  filters?: unknown;
  inputsMapping: Record<string, string>;
}

interface WebhookTriggerProps {
  value: WebhookTriggerValue;
  inputs: AgentInputField[];
  locked: boolean;
  wsId: string;
  onChange: (v: WebhookTriggerValue) => void;
}

export function WebhookTrigger({ value, inputs, locked, wsId, onChange }: WebhookTriggerProps) {
  const { webhooks, loading } = useWorkspaceWebhooks(wsId);
  const [showPicker, setShowPicker] = useState(!value.webhookId);

  const selectedWebhook = webhooks.find((w) => w.id === value.webhookId) ?? null;
  const knownPaths = pathsFromSchema(selectedWebhook?.payloadSchema);
  const knownEventTypes = selectedWebhook?.knownEventTypes ?? [];

  const update = (patch: Partial<WebhookTriggerValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-5">
      {/* Webhook picker */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Webhook</div>
        {showPicker || !value.webhookId ? (
          loading ? (
            <p className="text-xs text-muted-foreground">Loading webhooks…</p>
          ) : webhooks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No webhooks yet.{" "}
              <a href="#/webhooks" className="underline hover:text-foreground">Create one →</a>
            </p>
          ) : (
            <select
              className={inputCls}
              disabled={locked}
              value={value.webhookId}
              onChange={(e) => {
                update({ webhookId: e.target.value, listensFor: [], filters: undefined, inputsMapping: {} });
                if (e.target.value) setShowPicker(false);
              }}
            >
              <option value="">Select a webhook…</option>
              {webhooks.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{selectedWebhook?.name ?? value.webhookId}</span>
            {!locked && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => setShowPicker(true)}
              >Change ›</button>
            )}
          </div>
        )}
      </div>

      {/* Inbound URL */}
      {selectedWebhook && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Inbound URL</div>
          <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 font-mono text-xs">
            <span className="flex-1 truncate text-foreground">{selectedWebhook.ingestUrl}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(selectedWebhook.ingestUrl).catch(() => {})}
              className="text-muted-foreground hover:text-foreground flex-shrink-0"
            >⎘</button>
          </div>
        </div>
      )}

      {/* Event type filter */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Fire on event</div>
        <ListensForPicker
          value={value.listensFor}
          knownEventTypes={knownEventTypes}
          webhookPicked={Boolean(value.webhookId)}
          readOnly={locked}
          onChange={(listensFor) => update({ listensFor })}
        />
      </div>

      {/* Input mapping */}
      {inputs.length > 0 && value.webhookId && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Map inputs from payload</div>
          <datalist id="wh-paths">
            {knownPaths.map((p) => <option key={p} value={p} />)}
          </datalist>
          <div className="space-y-2">
            {inputs.map((inp) => (
              <div key={inp.name} className="flex items-center gap-2">
                <span className="text-sm w-32 truncate text-foreground" title={inp.name}>{inp.name}</span>
                <span className="text-muted-foreground text-sm">←</span>
                <input
                  list="wh-paths"
                  className={inputCls}
                  disabled={locked}
                  placeholder="$.field.path"
                  value={value.inputsMapping[inp.name] ?? ""}
                  onChange={(e) => {
                    const next = { ...value.inputsMapping, [inp.name]: e.target.value };
                    if (!e.target.value) delete next[inp.name];
                    update({ inputsMapping: next });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Condition filter */}
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Only fire if</div>
        <AcceptIfBuilder
          value={value.filters}
          knownPaths={knownPaths}
          readOnly={locked}
          onChange={(filters) => update({ filters })}
          datalistId="wh-filter-paths"
        />
        <datalist id="wh-filter-paths">
          {knownPaths.map((p) => <option key={p} value={p} />)}
        </datalist>
      </div>

      {/* Status banner */}
      {value.webhookId && (value.listensFor.length > 0 || value.filters) && (
        <div className="rounded-lg bg-emerald-950/20 border border-emerald-800/30 p-3 text-xs text-muted-foreground">
          Listening on{" "}
          {value.listensFor.length > 0 ? (
            value.listensFor.map((e, i) => (
              <span key={e}>
                <span className="font-medium text-foreground">{e}</span>
                {i < value.listensFor.length - 1 ? ", " : ""}
              </span>
            ))
          ) : (
            <span className="italic">any event</span>
          )}
          {value.filters ? " · with conditions" : ""}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npm run typecheck --workspace=packages/web
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/useWorkspaceWebhooks.ts \
        packages/web/src/components/agents/sections/WebhookTrigger.tsx
git commit -m "feat(web): WebhookTrigger sub-component with event filter + input mapping"
```

---

## Task 11: `TriggersSection` Rewrite

**Files:**
- Modify: `packages/web/src/components/agents/sections/TriggersSection.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `packages/web/src/components/agents/sections/TriggersSection.tsx`:

```typescript
import type { Agent, AgentUpdateInput, AgentInputField } from "@journeyman/core";
import { SectionShell } from "./SectionShell.tsx";
import { ScheduleTrigger } from "./ScheduleTrigger.tsx";
import { ApiTrigger } from "./ApiTrigger.tsx";
import { WebhookTrigger, type WebhookTriggerValue } from "./WebhookTrigger.tsx";
import { fromCron, summarizeCron, DEFAULT_SCHEDULE, toCron } from "../../../lib/cron-builder.ts";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

function TriggerRow({
  icon,
  title,
  enabled,
  summary,
  locked,
  onToggle,
  children,
}: {
  icon: string;
  title: string;
  enabled: boolean;
  summary: string;
  locked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-ring rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-card">
        <div className="flex items-center gap-3">
          <span className="text-base opacity-80">{icon}</span>
          <div>
            <div className="text-sm font-medium">{title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{enabled ? summary : "Off"}</div>
          </div>
        </div>
        {/* Toggle switch */}
        <label className="relative w-9 h-5 cursor-pointer flex-shrink-0">
          <input
            type="checkbox"
            className="sr-only peer"
            disabled={locked}
            checked={enabled}
            onChange={onToggle}
          />
          <span className="absolute inset-0 rounded-full border border-border bg-secondary transition-colors peer-checked:bg-primary peer-checked:border-primary" />
          <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-muted-foreground transition-transform peer-checked:translate-x-4 peer-checked:bg-primary-foreground" />
        </label>
      </div>
      {/* Body — only shown when enabled */}
      {enabled && (
        <div className="px-4 py-4 bg-card border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}

export function TriggersSection({ a, patch, locked, wsId }: SectionProps) {
  // ── Schedule ─────────────────────────────────────────────────────────────
  const scheduleTrigger = a.triggers.find((t) => t.type === "schedule") as
    | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> }
    | undefined;
  const scheduleEnabled = Boolean(scheduleTrigger);

  const scheduleFixedInputs = (scheduleTrigger?.fixedInputs ?? {}) as Record<string, string>;

  const scheduleSummary = scheduleEnabled && scheduleTrigger
    ? (fromCron(scheduleTrigger.cron)
        ? summarizeCron(fromCron(scheduleTrigger.cron)!, scheduleTrigger.timezone)
        : scheduleTrigger.cron)
    : "Off";

  const toggleSchedule = () => {
    const others = a.triggers.filter((t) => t.type !== "schedule");
    if (scheduleEnabled) {
      patch({ triggers: others });
    } else {
      const defaultCron = toCron(DEFAULT_SCHEDULE);
      patch({
        triggers: [
          ...others,
          { type: "schedule", cron: defaultCron, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        ],
      });
    }
  };

  const updateSchedule = (cron: string, timezone: string, fixedInputs: Record<string, string>) => {
    const others = a.triggers.filter((t) => t.type !== "schedule");
    patch({ triggers: [...others, { type: "schedule", cron, timezone, fixedInputs }] });
  };

  // ── API ───────────────────────────────────────────────────────────────────
  const apiTrigger = a.triggers.find((t) => t.type === "api");
  const apiEnabled = Boolean(apiTrigger);

  const toggleApi = () => {
    const others = a.triggers.filter((t) => t.type !== "api");
    patch({ triggers: apiEnabled ? others : [...others, { type: "api" }] });
  };

  // ── Webhook ───────────────────────────────────────────────────────────────
  const webhookTrigger = a.triggers.find((t) => t.type === "webhook") as
    | { type: "webhook"; webhookId: string; listensFor?: string[]; filters?: unknown; inputsMapping: Record<string, string> }
    | undefined;
  const webhookEnabled = Boolean(webhookTrigger);

  const webhookValue: WebhookTriggerValue = {
    webhookId: webhookTrigger?.webhookId ?? "",
    listensFor: webhookTrigger?.listensFor ?? [],
    filters: webhookTrigger?.filters,
    inputsMapping: webhookTrigger?.inputsMapping ?? {},
  };

  const toggleWebhook = () => {
    const others = a.triggers.filter((t) => t.type !== "webhook");
    if (webhookEnabled) {
      patch({ triggers: others });
    } else {
      patch({ triggers: [...others, { type: "webhook", webhookId: "", listensFor: [], inputsMapping: {} }] });
    }
  };

  const updateWebhook = (v: WebhookTriggerValue) => {
    const others = a.triggers.filter((t) => t.type !== "webhook");
    patch({ triggers: [...others, { type: "webhook", ...v }] });
  };

  return (
    <SectionShell title="Triggers" description="Choose how this agent is started.">
      <div className="space-y-3">
        {/* Schedule */}
        <TriggerRow
          icon="⏱"
          title="Schedule"
          enabled={scheduleEnabled}
          summary={scheduleSummary}
          locked={locked}
          onToggle={toggleSchedule}
        >
          <ScheduleTrigger
            cron={scheduleTrigger?.cron ?? toCron(DEFAULT_SCHEDULE)}
            timezone={scheduleTrigger?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
            fixedInputs={scheduleFixedInputs}
            inputs={a.inputs as AgentInputField[]}
            locked={locked}
            onChange={updateSchedule}
          />
        </TriggerRow>

        {/* API */}
        <TriggerRow
          icon="</>"
          title="API"
          enabled={apiEnabled}
          summary="Fire via HTTP with a bearer token"
          locked={locked}
          onToggle={toggleApi}
        >
          <ApiTrigger agentId={a.id} wsId={wsId} inputs={a.inputs as AgentInputField[]} />
        </TriggerRow>

        {/* Webhook */}
        <TriggerRow
          icon="🪝"
          title="Webhook"
          enabled={webhookEnabled}
          summary={webhookTrigger?.webhookId ? `Webhook ${webhookTrigger.webhookId.slice(0, 8)}…` : "Pick a webhook"}
          locked={locked}
          onToggle={toggleWebhook}
        >
          <WebhookTrigger
            value={webhookValue}
            inputs={a.inputs as AgentInputField[]}
            locked={locked}
            wsId={wsId}
            onChange={updateWebhook}
          />
        </TriggerRow>
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 2: Run type-check and import boundary check**

```bash
npm run typecheck && npm run check:boundaries
```

Expected: 0 errors on both.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: no new failures (pre-existing 5 failures from baseline are acceptable — see `deps-campaign-test-baseline` memory).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/agents/sections/TriggersSection.tsx
git commit -m "feat(web): rewrite TriggersSection — friendly schedule picker, token management, webhook builder"
```

---

## Self-Review

**Spec coverage check:**
- [x] Schedule: frequency pills (Hourly/Daily/Weekly/Monthly), contextual fields, timezone, live preview, advanced cron escape hatch, fixed inputs, "activates when enabled" note
- [x] API: enable/disable global toggle, endpoint row, token list with status badges, per-token Disable/Enable/Revoke (two-step confirm), issue-new-token with one-time reveal banner, curl usage example (collapsed)
- [x] Webhook: enable/disable toggle, webhook picker dropdown, ingest URL copy, ListensForPicker, input mapping with pathsFromSchema datalist, AcceptIfBuilder, status banner
- [x] All three: toggle OFF = collapsed, sub-label shows "Off"; toggle ON = expand inline, sub-label shows summary
- [x] DB: `disabled_at` migration #059
- [x] Backend: PATCH toggle route, `/fire` checks `disabled_at IS NULL` + API trigger presence
- [x] Backend: `listensFor` check in `fireAgentForWebhook`, `eventType` threaded from `webhook-ingest.ts`
- [x] Core types: `listensFor?: string[]`, simplified `{ type: "api" }` trigger

**Placeholder scan:** No "TBD", "TODO", or hand-wavy steps found. All code is shown in full.

**Type consistency:**
- `ScheduleState` defined in `cron-builder.ts`, used identically in `ScheduleTrigger.tsx`
- `WebhookTriggerValue` defined and exported from `WebhookTrigger.tsx`, imported in `TriggersSection.tsx`
- `ApiToken` interface defined in `agents.ts`, used as `ApiToken[]` in `ApiTrigger.tsx`
- `toCron(DEFAULT_SCHEDULE)` call: `toCron` signature is `(s: ScheduleState): string` — `DEFAULT_SCHEDULE` is `ScheduleState` ✓
- `fromCron(cron)` returns `ScheduleState | null` — optional chain `!` used where null is excluded ✓
