# Custom Agents — Phase 4 Implementation Plan (Notifications · Safety Rails · Observability)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. **Three independent sub-plans (4a/4b/4c) — each is shippable on its own; build in any order.**

**Goal:** Make agents production-operable: deliver **notifications** on run success/failure (Slack/Console), enforce **safety rails** (concurrency limit, daily cap, spend budget, kill-switch), and add **observability** (metrics, alerts, audit log).

**Spec:** `docs/superpowers/specs/2026-06-17-custom-agents-design.md` §7.3–7.4, §15.1, §15.4, §16.

**Verify-first (build-time):** these need confirmation in code before the dependent steps —
1. **Run-terminal hook** — where the orchestrator/worker marks a `WorkflowInstance` `completed`/`failed` (search `IWorkflowInstanceStore.setStatus` callers in `packages/orchestrator`). The notification + metrics hooks attach there.
2. **Org settings** — is there an org-settings table/store for the `paused` flag + default limits, or add one (`jm_org_agent_settings`)?
3. **Token/cost usage** — does `runCustomPrompt`'s result or the SDK message stream expose token counts the worker can record? (Claude `result` message has usage; check `sdk-logger`.)

---

# Phase 4a — Notifications (Slack delivery + on-terminal hook)

## Task 1: Implement SlackProvider.send
**Files:** `packages/notification-provider/src/providers/slack/index.ts` (+ a `send` op).
- [ ] Implement `send({channel, message, title, ...})` against Slack: if the connection config method is `token`, call `https://slack.com/api/chat.postMessage` with `Authorization: Bearer <botToken>` + `{ channel, text }`; if `webhook`, POST the incoming-webhook URL with `{ text }`. Return `{ success, messageId?, error? }`. Read the real `SendNotificationOptions`/`SendNotificationResult` from `packages/core/src/types/notification.types.ts` and match exactly.
- [ ] Unit test with `fetch` mocked: success + error paths.

## Task 2: Notification-connection resolution
**Files:** new helper in `packages/api-server` or `@journeyman/connections`.
- [ ] Given an agent's `notifications.connectionId`, load the connection (category `notification`), decrypt its credential (`getConnectionSealed` + `open`), and construct the provider (`SlackProvider` with token/webhook, or `ConsoleProvider`). Return an `INotificationProvider` + the resolved channel (`notifications.target`).

## Task 3: On-terminal notification hook
**Files:** the run-terminal site (verify-first #1) + a `notify-on-terminal.ts` service.
- [ ] When an instance tagged with `agentId` reaches `completed`/`failed`, load the agent, check `notifications.on` includes the terminal state, resolve the provider (Task 2), and `send` a summary (agent name, status, run id, PR link if present). Failures to notify are logged, never fail the run.
- [ ] The hook must run **outside** the agent-run step (so it fires even on crash/timeout) — attach at the orchestrator status-transition, not in the step handler.
- [ ] Test: a fake instance + agent with `on: ["failure"]` → provider.send called once on failure, not on success.

## Task 4: UI — bind a notification connection
**Files:** `EditAgentModal.tsx` Notifications tab.
- [ ] Replace the Phase-1 shell: a notification-connection picker (from `connectionsApi.listOrg(orgId, "notification")`) + channel/target input + the existing success/failure toggles. Save to `agent.notifications`.

---

# Phase 4b — Safety rails (concurrency · daily cap · budget · kill-switch)

## Task 5: Settings + limits model
**Files:** migration `047_agent_safety.sql`, core types, an org-settings store.
- [ ] `AgentSafetyLimits` already specced (§15.1): `maxConcurrentRuns?`, `dailyRunCap?`, `budget?{maxTokens?,maxCostUsd?}`. Add it to the `Agent` model (definition JSONB — no migration for the agent side) and to a new **org settings** row: `jm_org_agent_settings (org_id PK, paused boolean, max_concurrent_runs int, daily_run_cap int, budget jsonb)`.
- [ ] A `jm_agent_run_counters (org_id, agent_id, day date, runs int, tokens bigint, cost_usd numeric, PRIMARY KEY(agent_id, day))` for daily cap + budget tallies.

## Task 6: Enforce in the submit path
**Files:** `packages/agents/src/run-agent.ts` (or a guard called before it) + the trigger callers.
- [ ] Before `submit`, check in order (fail-safe = skip + reason): **paused** (org) → **concurrency** (count running instances for agent + org vs limits) → **daily cap** (today's counter) → **budget** (token/cost tally). Return a typed `{ skipped: reason }` rather than throwing; callers (manual/api/webhook/schedule) translate to the right response (e.g. API `/fire` → `429`/`202 skipped`).
- [ ] Increment the run counter on submit; the worker updates tokens/cost on terminal (ties to 4c metrics).
- [ ] Tests for each rail (at-limit → skipped; under-limit → runs).

## Task 7: Kill-switch UI + per-run cost ceiling
**Files:** an org-admin settings page + `EditAgentModal` Behavior tab.
- [ ] Org "Pause all agents" toggle (writes `jm_org_agent_settings.paused`) + per-agent/per-org limit fields.
- [ ] Per-run token/cost ceiling (§15.1 #5): pass `maxTokens` into the run; abort if exceeded (build on the §14 cost capture).

---

# Phase 4c — Observability (metrics · alerts · audit log)

## Task 8: Metrics on terminal
**Files:** the run-terminal hook (shared with 4a Task 3) + a metrics emitter.
- [ ] On terminal, record run count + success/fail + duration + tokens/cost, tagged `agentId`/`orgId`. Phase 4c: structured metric log lines + persist the per-day tally (Task 5's counter); a Prometheus endpoint is optional/follow-up.

## Task 9: Audit log
**Files:** migration `048_audit_log.sql` (`jm_audit_log: id, org_id, actor_user_id, action, target_type, target_id, detail jsonb, created_at`), an `audit()` helper, calls in the agent + connection routes.
- [ ] Record: agent create/edit/delete/enable/disable, connection create/delete, manual run, kill-switch toggle, token issue/revoke. One `audit(c, {...})` call per sensitive route.
- [ ] An admin route `GET /api/orgs/:orgId/audit` (paged) + a simple admin view.

## Task 10: Alerts
**Files:** extend the scheduler tick (or a new tick) to evaluate thresholds.
- [ ] Threshold rules over the metrics/counters (failure rate over X%, near-budget, a run stuck/timed out) → send via the notification path (4a). Keep rules simple + org-configurable defaults.

---

## Final verification (per sub-plan)
- [ ] `npm run typecheck` exit 0; `npm run check:boundaries` clean.
- [ ] New unit tests pass (SlackProvider, notify-on-terminal, each safety rail, audit).
- [ ] E2E: a failing run posts a Slack failure message; hitting the concurrency limit skips a run with a clear reason; an enable/disable shows up in the audit log.
- [ ] Commit at the end of each sub-plan (4a, 4b, 4c separately).

## Scope / deferrals
- Rate-limiting the public `/fire` + inbound webhook endpoints (mentioned for Phase 3) folds into 4b's safety work.
- A full Prometheus/Grafana stack is out of scope — 4c emits structured metrics + a tally; wiring a dashboard is ops follow-up.
- Per-key concurrency lock (§15.1 #4) and manual webhook replay remain follow-ups.
