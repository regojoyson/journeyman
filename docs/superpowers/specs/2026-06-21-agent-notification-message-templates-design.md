# Agent Notification Message Templates Design

**Date:** 2026-06-21
**Status:** Implemented (2026-06-21)
**Follows:** [2026-06-21-notification-providers-end-to-end-design.md](2026-06-21-notification-providers-end-to-end-design.md)

> **Implementation notes:**
> - The `console` provider was **removed** ([2026-06-21-notification-ux-hardening-design.md](2026-06-21-notification-ux-hardening-design.md)) — ignore the `console` rows below; only Slack and Email remain.
> - Preset shape reconciliation: agent presets (`NOTIFICATION_PRESETS`, per-outcome, placeholder-driven) are intentionally **separate** from the step's `NOTIFICATION_SCAFFOLDS` (single, plain-text, no renderer). They serve different surfaces — kept distinct rather than merged.
> - Shipped: `AgentNotifications.templates`; `notification-templates.ts` (`renderNotificationTemplate` + `NOTIFICATION_PLACEHOLDERS`); `notification-presets.ts`; render-with-fallback in `notify-on-terminal.ts`; preset picker + per-outcome subject/body editors in `NotificationsSection.tsx`. Tests: renderer (5), presets (3), notify-on-terminal template + fallback (2).

## Summary

Let each agent define custom **subject + body** text for its run-finished notification,
separately for the **success** and **failure** outcomes, with placeholder substitution
(`{agent}`, `{status}`, `{runId}`, `{workflow}`, `{duration}`, `{failedNode}`) and a set of
**preset starter templates** the user can pick from and then edit. Today the text is hardcoded
in the delivery hook; the agent editor only exposes when (success/failure) and where
(connection + target).

The feature is **provider-agnostic by construction**: templates render to two strings that feed
the existing `provider.send({ title, message, ... })` call, so they apply unchanged to every
notification provider (Slack, Console) and every email method (SMTP, Resend, SendGrid, Mailgun,
SES). There is no per-provider or per-method branching in the template layer.

---

## 1. Problem

`AgentNotifications` (`packages/core/src/types/agent.types.ts`) stores only
`{ on, connectionId, target }`. The message text is hardcoded in
`packages/api-server/src/services/notify-on-terminal.ts`:

- subject/title → `Agent "<name>" <completed|failed>`
- body → `Run <instanceId> <completed|failed>.`

Every agent therefore sends identical text, and there is no UI box to change it.

---

## 2. Data Model

Additive change to `AgentNotifications` — **no migration** (the `notifications` object is stored
as a JSON blob and flows through the form/store untouched):

```ts
export interface AgentNotificationTemplate {
  subject?: string;
  body?: string;
}

export interface AgentNotifications {
  on: Array<"success" | "failure">;
  connectionId?: string;
  target?: string;
  templates?: {
    success?: AgentNotificationTemplate;
    failure?: AgentNotificationTemplate;
  };
}
```

Every field is optional. A blank/absent `subject` or `body` falls back to the current default
text, so existing agents are unaffected.

---

## 3. Placeholders + Renderer

**New file:** `packages/core/src/registries/notification-templates.ts`
**Exported from:** `packages/core/src/index.ts`

Mirrors the `notification-fields` registry pattern so both the UI (hints) and the backend
(rendering) share one definition.

```ts
export interface NotificationPlaceholder {
  token: string;        // e.g. "{agent}"
  description: string;  // shown as a UI hint
}

export const NOTIFICATION_PLACEHOLDERS: NotificationPlaceholder[] = [
  { token: "{agent}", description: "Agent name" },
  { token: "{status}", description: "completed or failed" },
  { token: "{runId}", description: "Workflow instance id" },
  { token: "{workflow}", description: "Workflow name" },
  { token: "{duration}", description: "Run duration (e.g. 1m 12s)" },
  { token: "{failedNode}", description: "Id of the node that failed (failure only)" },
];

/** Replace known {token}s in `tpl` with `vars[token-without-braces]`.
 *  Unknown tokens are left untouched. */
export function renderNotificationTemplate(tpl: string, vars: Record<string, string>): string;
```

Token syntax is `{name}`. Rendering substitutes only the known variables present in `vars`;
any other `{...}` sequence is left verbatim (no surprising deletions).

---

## 3b. Preset Starter Templates

Well-crafted starter templates the user can pick to fill the subject/body boxes, then edit.
**No data-model change** — a preset is a UI convenience that writes plain strings into the same
`templates.{success,failure}.{subject,body}` fields. The preset is never referenced or stored;
only the resulting strings are saved.

**New file:** `packages/core/src/registries/notification-presets.ts`, exported from core.

```ts
export interface NotificationPreset {
  id: string;
  label: string;          // dropdown label
  description: string;    // one-line hint
  success: { subject: string; body: string };
  failure: { subject: string; body: string };
}

export const NOTIFICATION_PRESETS: NotificationPreset[];
```

Curated set (cross-provider clean — emoji + labelled lines + blank lines, **no** Slack-only
`*markdown*`, which would show literal asterisks in email):

| id | label | shape |
|---|---|---|
| `concise` | Concise — one line | subject `{agent}: ✅ success` · body `{agent} finished run {runId} in {duration}.` (failure: ❌ + `failed at {failedNode}`) |
| `detailed` | Detailed — labelled multi-line | subject `✅ {agent} succeeded` · body `✅ {agent} succeeded\n\nRun: {runId}\nWorkflow: {workflow}\nDuration: {duration}` (failure adds `Failed at: {failedNode}`) |
| `status` | Status only — minimal | subject `{agent} — {status}` · body `Run {runId}.` |

Every placeholder used in every preset must be a known token from `NOTIFICATION_PLACEHOLDERS`
(enforced by the test in §8).

## 4. Delivery Hook

`packages/api-server/src/services/notify-on-terminal.ts` already fetches the agent and the
`WorkflowInstance`. The instance carries everything the placeholders need
(`workflowNameSnapshot`, `durationMs`, `failedAtNodeId`).

Behavior:

1. `want = status === "completed" ? "success" : "failure"` (unchanged).
2. Build `vars`:
   - `agent` → `agent.name`
   - `status` → `status` (`completed` | `failed`)
   - `runId` → `workflowInstanceId`
   - `workflow` → `instance.workflowNameSnapshot ?? ""`
   - `duration` → formatted `instance.durationMs` (e.g. `1m 12s`; `""` when null)
   - `failedNode` → `instance.failedAtNodeId ?? ""`
3. `const tpl = agent.notifications.templates?.[want];`
4. `subject = tpl?.subject ? renderNotificationTemplate(tpl.subject, vars) : \`Agent "${agent.name}" ${status}\``
5. `body = tpl?.body ? renderNotificationTemplate(tpl.body, vars) : \`Run ${workflowInstanceId} ${status}.\``
6. `provider.send({ channel: agent.notifications.target ?? "", title: subject, message: body, sessionId: workflowInstanceId })` — call shape unchanged.

The instance lookup already happened earlier in the hook; reuse that value (do not fetch twice).
All existing guards (terminal-status, subscribed-outcome, notification-category, swallow-errors)
are unchanged.

---

## 5. UI

`packages/web/src/components/agents/sections/NotificationsSection.tsx`.

Above the per-outcome inputs, a **"Start from a template"** `<select>` lists
`NOTIFICATION_PRESETS` (label + description as hint). Choosing one fills **both** outcomes'
subject/body from the preset (overwrites current values; everything stays editable). The first
option is a blank "Custom…" that changes nothing. Selecting a preset writes strings into
`notifications.templates.{success,failure}.{subject,body}` via `patch` — it does not store the
preset id.

For each outcome whose checkbox is enabled (`on` includes `success` / `failure`), render that
outcome's **Subject** and **Body** inputs directly under its checkbox:

- Labels reuse the provider-aware copy from `notificationFields(selectedProvider)` — Subject uses
  the `title` field label where present (email: "Subject"); Body uses the `message` label
  (email: "Email body", slack/console/default: "Message").
- A single muted hint line lists the available placeholders from `NOTIFICATION_PLACEHOLDERS`
  (e.g. `Placeholders: {agent} {status} {runId} {workflow} {duration} {failedNode}`).
- Writes via `patch` into `notifications.templates.<outcome>.<subject|body>`; clearing an input
  removes the key (so it reverts to the default text).

When neither checkbox is on, no template inputs show. The connection picker and recipient field
are unchanged from the prior spec.

---

## 6. Provider Coverage

No provider-specific code. Because the hook produces `title` + `message` and calls the shared
`provider.send(...)`:

| Provider / method | subject (`title`) | body (`message`) |
|---|---|---|
| Slack (token / webhook) | bold first line | message text |
| Email — SMTP / Resend / SendGrid / Mailgun / SES | email subject header | plain-text body |
| Console | logged | logged |

A future provider/method inherits templating automatically.

---

## 7. Affected Files

| File | Change |
|---|---|
| `packages/core/src/types/agent.types.ts` | Add `AgentNotificationTemplate` + `templates` on `AgentNotifications` |
| `packages/core/src/registries/notification-templates.ts` | **New** — placeholders + `renderNotificationTemplate` |
| `packages/core/src/registries/notification-templates.test.ts` | **New** — renderer unit tests |
| `packages/core/src/registries/notification-presets.ts` | **New** — `NOTIFICATION_PRESETS` starter templates |
| `packages/core/src/registries/notification-presets.test.ts` | **New** — preset placeholder-validity test |
| `packages/core/src/index.ts` | Export notification-templates + notification-presets |
| `packages/api-server/src/services/notify-on-terminal.ts` | Render per-outcome subject/body with fallback |
| `packages/api-server/src/services/notify-on-terminal.test.ts` | Custom-template + fallback cases |
| `packages/web/src/components/agents/sections/NotificationsSection.tsx` | Preset picker + per-outcome subject/body inputs + placeholder hint |

No DB migration. No changes to providers, `buildNotificationProvider`, or the workflow
send-message step (that step already has its own message inputs).

---

## 8. Testing

| Test | Coverage |
|---|---|
| `notification-templates.test.ts` | substitution of each token; unknown token left verbatim; empty template; all-vars-empty |
| `notification-presets.test.ts` | every `{token}` in every preset's subject/body is a known `NOTIFICATION_PLACEHOLDERS` token; ids are unique |
| `notify-on-terminal.test.ts` | custom success subject/body rendered with vars; blank fields fall back to defaults; failure template selected for `failed` status |
| `npm run typecheck` / `check:boundaries` | pass — new module is pure, imports nothing |

---

## 9. Out of Scope

- Rich formatting (Slack blocks, HTML email) — body is plain text rendered with placeholders.
- Templating the workflow send-message step — it already exposes message inputs.
- Per-attachment / multi-recipient templating.
