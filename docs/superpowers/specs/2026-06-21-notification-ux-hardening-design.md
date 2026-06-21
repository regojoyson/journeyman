# Notification UX Hardening Design

**Date:** 2026-06-21
**Status:** Implemented
**Follows:** [2026-06-21-notification-providers-end-to-end-design.md](2026-06-21-notification-providers-end-to-end-design.md)
**Supersedes:** [2026-04-21-console-notification-provider-design.md](2026-04-21-console-notification-provider-design.md)

> Backfilled spec — this documents changes that were implemented directly during a
> working session. It is the record of what was built, not a forward plan.

## Summary

Five related changes that make the notification surfaces actually usable end-to-end and
predictable on failure:

1. **Remove the `console` notification provider** entirely.
2. **Un-gate the `send-message` workflow step** (was hidden behind `comingSoon`).
3. **Optional/required delivery** for the `send-message` step — failures don't fail the
   workflow unless the step is marked required.
4. **Plain-text starter scaffolds** for the `send-message` step.
5. **Agent notification failures are logged and ignored** — never fail the agent run.

No DB migration. No new provider behavior beyond what the prior end-to-end spec established.

---

## 1. Remove the `console` provider

`console` could not be created as a real connection (connection creation requires a
credential; console has none) and the step connection resolver rejects credential-less
connections — so it was only ever reachable as a silent fallback. Removed everywhere:

| Location | Change |
|---|---|
| `packages/notification-provider/src/providers/console/` | Deleted (class + tests) |
| `packages/notification-provider/src/index.ts` | Drop `ConsoleProvider` export |
| `packages/notification-provider/src/build-provider.ts` | Drop import + `case "console"` (unknown providers, incl. `console`, now throw `ConfigurationError`) |
| `packages/core/src/registries/provider-catalog.ts` | Remove console entry; **`slack` becomes the notification `isDefault`** |
| `packages/core/src/registries/notification-fields.ts` | Drop the `console` case (default case unchanged) |
| `packages/orchestrator/src/cli-worker.ts` | Notification factory fallback `?? "console"` → `?? ""` (no implicit console) |
| `packages/web/src/routes/ConnectionsPage.tsx` | Remove the Console `<option>` |
| `CLAUDE.md` | Drop ConsoleProvider; note EmailProvider implemented |

`defaultProviderForKind("notification")` has no consumer that requires a value, so dropping
console's `isDefault` is safe (slack is set as default defensively).

## 2. Un-gate the `send-message` step

`packages/steps/src/notifications/send-message.tsx`: remove `comingSoon: true`. The step is
now draggable from the palette. Its runtime path was already wired (node `connectionId` →
conductor task input → `connectionResolver` → `ctx.connection` → `SendMessageStepHandler` →
`buildNotificationProvider` → `send`).

## 3. Optional / required delivery

A new `required` boolean config on the step (default **false** = optional).

- `send-message.meta.ts`: `required: z.boolean().optional()` on the config schema.
- `send-message.tsx`: `required?: boolean` on the config type; `required: false` default; a
  `required` checkbox in `configFields` (kept in the static `configFields` so the editor's
  stale-key sweep preserves it).
- `ConfigTab.tsx` (`notificationConfigFields`): emits the `required` checkbox so it renders for
  notification steps (whose fields are otherwise provider-aware-only).
- `send-message-step-handler.ts`: a `softFail(errorClass, msg)` helper centralises the rule —
  when **required**, return `{ kind: "failure" }` (`NotifyFailed` retryable; `NoConnection` /
  `InvalidInput` not); when **optional**, log a warning and return
  `{ kind: "success", output: { delivered: false, error } }`. Success →
  `{ delivered: true, messageId }`. A missing `ctx.connection` is treated as a delivery
  problem (soft-failable), not a hard crash.

## 4. Plain-text starter scaffolds (step)

`packages/core/src/registries/notification-scaffolds.ts` — `NOTIFICATION_SCAFFOLDS:
{ id, label, subject, body }[]` (Generic alert / Deployment / Build-CI / Pull request).

These are **plain prose with no `{placeholder}` tokens** — the workflow step has no agent-style
placeholder renderer; dynamic values are inserted by the user via the flow editor's `@`-mention
bindings. `ConfigTab.tsx` renders a "Start from a template" `<select>` for notification steps
that writes the chosen scaffold's `subject`/`body` into `config.title`/`config.message`.
Exported from `packages/core/src/index.ts`.

## 5. Agent notification failures: log + ignore

`packages/api-server/src/services/notify-on-terminal.ts`: a module logger
(`createLogger("agent:notify")`) now `log.warn`s when `provider.send` returns
`success: false` and in the surrounding `catch`. The hook still never throws — a notification
problem can never fail the agent run.

---

## 6. Tests

| Test | Coverage |
|---|---|
| `notification-provider/src/build-provider.test.ts` | `console` now throws (unknown provider) alongside other unknowns |
| `api-server/.../notify-on-terminal.test.ts` | console cases removed; "never throws" rerouted through slack |
| `orchestrator/.../send-message-step-handler.test.ts` (new) | success→delivered:true; optional failure/throw/no-connection→success delivered:false; required failure→NotifyFailed retryable; required no-connection→NoConnection non-retryable; missing input required→InvalidInput |
| `core/.../notification-scaffolds.test.ts` (new) | non-empty fields; unique ids; **no `{placeholder}` tokens** |

## 7. Verification status

Changed backend packages + core + web typecheck clean; notification-provider, notify-on-terminal,
send-message-step-handler, scaffolds, and flow-editor suites pass; import boundaries clean.

> Known unrelated breakage: `flow-editor/src/canvas/auto-populate-defaults.test.ts` has a
> `CustomAiStep` type error from separate in-flight work — unmodified file, unrelated to
> notifications, left untouched.

## 7a. Corner cases (dry-run review)

- **Provider construction must be soft-failable.** `buildNotificationProvider` is called *inside*
  the handler's `try`, so an unknown/legacy provider (e.g. a leftover `console` connection) is
  soft-failed by the `required` rule rather than crashing the step. (Tested.)
- **Known limitation — connection-resolution failures bypass the optional tick.** If a step's
  connection is deleted or has no credential, `connectionResolver` throws in `worker-harness`
  and the step ends as `FAILED_WITH_TERMINAL_ERROR` *before* the handler runs — so an
  **optional** notify step can still fail the workflow in that specific case. The `required`
  flag only governs handler-level outcomes (send failure, no-connection-on-node, bad provider).
  Making resolution failures lenient for optional notify steps would require threading the
  step's optionality into `worker-harness` — deferred.
- **Slack Subject field** — `notificationFields("slack")` now includes an optional `title`
  ("Subject"), rendered as a bold first line by `SlackProvider`. Previously hidden; now visible
  and editable in the Slack step form.
- **Output schema** aligned to the actual handler output (`delivered`, `messageId`).

## 8. Out of scope

- Agent per-outcome message templates + presets — see
  [2026-06-21-agent-notification-message-templates-design.md](2026-06-21-agent-notification-message-templates-design.md)
  (specced, **not yet implemented**).
- Rich/native formatting (Slack Block Kit, HTML email).
