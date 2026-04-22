# @journeyman/notification-provider

Notification providers for Journeyman. Implements `INotificationProvider` from `@journeyman/core`.

## Providers

| Provider | ID | Status | Notes |
|---|---|---|---|
| `ConsoleProvider` | `console` | Implemented | Logs via Pino; no external calls |
| `SlackProvider` | `slack` | Stub | Throws `not implemented` |

## ConsoleProvider

Logs one `info`-level entry per notification containing `channel`, `title`, `message`, and `sessionId`.

- In development (`NODE_ENV != production`): pretty-printed via `pino-pretty`.
- In production: structured JSON.

Intended for local dev and CI environments where a real Slack workspace is unavailable. Never fails — no external calls.

```yaml
providers:
  notification: console
```

## SlackProvider

Planned. Currently throws `not implemented` on `send`.

```yaml
providers:
  notification: slack
```

## Exports

```typescript
import { ConsoleProvider, SlackProvider } from "@journeyman/notification-provider";
import type { INotificationProvider } from "@journeyman/core";
```

## Documentation

- [Providers reference](../../docs/providers.md#notification-providers) — provider config details
