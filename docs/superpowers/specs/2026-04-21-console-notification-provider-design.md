# Console Notification Provider — Design Spec

**Date:** 2026-04-21
**Status:** Approved

---

## Overview

Add a `ConsoleProvider` to `@journeyman/notification-provider` that satisfies `INotificationProvider` by writing to the application logger instead of an external service. It is intended for local development, testing, and CI environments where a real Slack workspace is unavailable.

---

## Architecture

The provider lives alongside `SlackProvider` in the `notification-provider` package and follows the same structure:

```
packages/notification-provider/src/providers/
├── slack/index.ts          (existing)
└── console/index.ts        (new)
```

It is exported from the package root and registered in the same places `SlackProvider` is registered.

---

## ConsoleProvider

**File:** `packages/notification-provider/src/providers/console/index.ts`

**Class:** `ConsoleProvider implements INotificationProvider`

**Logger:** `createLogger("provider:console")` from `@journeyman/core`. Uses the shared Pino instance — pretty-printed in dev, structured JSON in production.

**`send()` behaviour:**
- Logs at `info` level with fields: `channel`, `title` (if present), `message`, `sessionId`
- Returns `{ success: true, messageId: Date.now().toString(), sessionId }`
- Never throws; no external calls

**`meta` static field:**
```ts
static meta: IProviderMeta = {
  id: "console",
  name: "Console",
  description: "Logs notifications to the application logger (dev/test use)",
  category: "notification",
};
```

---

## Registration Sites

All three locations that currently register `SlackProvider` must also register `ConsoleProvider`:

| File | Import source |
|---|---|
| `packages/pipeline-server/src/main.ts` | `@journeyman/notification-provider` |
| `packages/pipeline/src/cli-commands/validate-config.ts` | `@journeyman/notification-provider` |
| `packages/pipeline/src/cli-commands/run-once.ts` | `@journeyman/notification-provider` |

---

## Exports

`packages/notification-provider/src/index.ts` — add `ConsoleProvider` to the named exports.

---

## Documentation Updates

- **`docs/providers.md`** — add ConsoleProvider entry in the Notification section
- **`docs/phases.md`** — update the `notify` phase entry to mention `console` as a valid provider id

---

## Error Handling

`send()` does not call any external service and cannot fail in normal operation. No error handling is required beyond the standard `unwrap()` path in `NotifyPhase`.

---

## Out of Scope

- No changes to flow YAML configs (provider selection remains `slack` in existing flows)
- No changes to `INotificationProvider` interface or core types
