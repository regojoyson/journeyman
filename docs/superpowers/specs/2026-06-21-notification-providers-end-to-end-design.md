# Notification Providers End-to-End Design

**Date:** 2026-06-21
**Status:** Draft
**Follows:** [2026-06-20-email-notification-connection-design.md](2026-06-20-email-notification-connection-design.md)

## Summary

Make every notification provider type (`console`, `slack`, `email`) usable through **both**
notification surfaces — the workflow **send-message step** and **agent run-finished
notifications** — by collapsing two divergent provider-construction sites into one shared
factory. Also fix the 11 TypeScript errors introduced with the email provider, and clear the
now-stale "Slack not implemented" flags.

The email *connection* (UI, test endpoint, provider class, step factory) already exists from
the prior spec. This spec finishes the wiring so a notification connection of **any** type
works everywhere, and unblocks the build.

---

## 1. Problem

### 1a. Build is broken (11 type errors)

`SendNotificationResult.sessionId` is optional (`string | undefined`), but the five private
send methods in `EmailProvider` declare their parameter as `sessionId: string`. Passing the
optional value to them fails typecheck (5 errors in `index.ts`). The SES test additionally
reads `cmdArg.Destination.ToAddresses` etc., where the AWS `SendEmailCommandInput` type makes
every nested field optional (6 errors in `email.test.ts`).

Both are type-only — runtime behavior is correct.

### 1b. The two construction sites have diverged

Notification providers are built from a `Connection` (provider string + `config` + decrypted
`credential`) in **two** places, with **two** independent `switch` statements:

| Provider | Workflow step (`cli-worker.ts` `notification` factory) | Agent (`notify-on-terminal.ts`) |
|---|---|---|
| `console` | ✅ | ✅ |
| `slack` | ❌ throws `"Slack provider not yet implemented"` | ✅ (token / webhook) |
| `email` | ✅ | ❌ falls through `else { return }` — sends nothing |

Neither path supports all types. An agent with an email notification connection silently sends
nothing; a workflow notify step pointed at a Slack connection throws. The agent path must be
generic over **any** `category: "notification"` connection, not Slack-specific.

### 1c. Stale "Slack unimplemented" flags

`SlackProvider` is fully implemented (token → `chat.postMessage`, webhook → incoming webhook),
but three places still say it is not:

- `provider-catalog.ts`: `{ value: "slack", implemented: false }`
- `cli-worker.ts` notification factory: throws "not yet implemented"
- `CLAUDE.md` status table: lists `SlackProvider` as a stub

---

## 2. Approach

A single pure factory function owned by the package that owns the provider classes
(`@journeyman/notification-provider`), called by both construction sites. The two `switch`
statements collapse to one source of truth, so "all types, both surfaces" holds by construction
and cannot drift again when a fourth provider is added.

Rejected alternatives:

- **Patch each site independently** (add slack to the worker, add email to the agent path):
  faster but re-creates two parallel switches — the exact divergence that caused this bug.
- **Build the provider inside connection resolution**: conflates credential storage with
  provider instantiation and breaks the `ProviderFactory` pattern git/issue providers rely on.

---

## 3. Design

### 3a. Fix compile errors (independent — unblocks build)

`packages/notification-provider/src/providers/email/index.ts`: widen the five private send
methods' parameter `sessionId: string` → `sessionId?: string`, matching the optional
`SessionResult.sessionId`. (The `send()` public method already destructures the optional value.)

`packages/notification-provider/src/providers/email/email.test.ts`: narrow the six `cmdArg.*`
accesses in the SES assertion with non-null assertions (`cmdArg.Destination!.ToAddresses`,
`cmdArg.Message!.Subject!.Data`, `cmdArg.Message!.Body!.Text!.Data`). The mock always populates
these; the assertions document the expected shape.

### 3b. Shared factory `buildNotificationProvider`

**New file:** `packages/notification-provider/src/build-provider.ts`
**Exported from:** `packages/notification-provider/src/index.ts`

```ts
export function buildNotificationProvider(
  provider: string,
  config: Record<string, unknown>,
  credential: string,
): INotificationProvider
```

A pure function — takes the provider key, the connection `config` object, and the **already
decrypted** credential. No DB, no secrets-package dependency (callers decrypt). Behavior:

| provider | construction |
|---|---|
| `console` | `new ConsoleProvider()` (credential ignored) |
| `slack` | `config.method === "webhook"` → `new SlackProvider({ method: "webhook", webhookUrl: credential })`, else `new SlackProvider({ method: "token", token: credential })` |
| `email` | read `config.method`; build the `EmailProviderOptions` union (the switch currently inlined in `cli-worker.ts`); `new EmailProvider(opts)` |
| unknown | throw `Error` with `name: "ConfigurationError"`, message `Unknown notification provider: <provider>` |

Email sub-method mapping (moved verbatim from `cli-worker.ts`):

| method | opts |
|---|---|
| `smtp` | `{ method, host, port: Number(config.port), secure: Boolean(config.secure), from, username, password: credential }` |
| `resend` | `{ method, from, apiKey: credential }` |
| `sendgrid` | `{ method, from, apiKey: credential }` |
| `mailgun` | `{ method, from, domain, apiKey: credential, region: config.region ?? "us" }` |
| `ses` | `{ method, from, region, accessKeyId, secretAccessKey: credential }` |
| missing / unknown method | throw `ConfigurationError` |

`from`, `host`, etc. are read from `config`. The "missing config.method" and "unknown email
method" guards from the current factory are preserved.

### 3c. Rewire the two call sites

**`packages/orchestrator/src/cli-worker.ts`** — the `notification` `ProviderFactory` becomes:

```ts
const notification: ProviderFactory<INotificationProvider> = (key, _env, connection) => {
  const provider = connection?.provider ?? key ?? "console";
  return buildNotificationProvider(provider, connection?.config ?? {}, connection?.credential ?? "");
};
```

This removes the Slack throw and the inlined email switch; the worker now supports all three
types (Slack newly works in the step).

**`packages/api-server/src/services/notify-on-terminal.ts`** — replace the
`console`/`slack`/`else return` branching with: fetch the sealed credential, `open()` it
(default to `""` when a connection has no credential, e.g. console), then
`buildNotificationProvider(conn.provider, conn.config ?? {}, credential)`. Email and any future
type now work. The surrounding contract is unchanged: still gated on
`conn.category === "notification"`, still swallows all errors so a notification failure can
never fail a run, still uses `agent.notifications.target` as the channel.

### 3d. Clear stale flags

- `packages/core/src/registries/provider-catalog.ts`: slack `implemented: false` → `true`.
- `CLAUDE.md`: status table — mark `SlackProvider` implemented (token + webhook).

---

## 4. Testing

| Test | Coverage |
|---|---|
| `build-provider.test.ts` (new) | console / slack-token / slack-webhook / each email method → correct provider instance + options; missing `config.method` and unknown provider/method throw `ConfigurationError` |
| `email.test.ts` | existing suite stays green after the assertion fix |
| `notify-on-terminal.test.ts` | add an `email` connection case asserting `EmailProvider.send` is invoked; keep existing console/slack cases green |
| `npm run typecheck` | 0 errors (was 11) |
| `npm run check:boundaries` | passes — the new module imports only `@journeyman/core` types + sibling provider classes |

---

## 5. Affected Files

| File | Change |
|---|---|
| `packages/notification-provider/src/providers/email/index.ts` | `sessionId: string` → `sessionId?: string` (×5) |
| `packages/notification-provider/src/providers/email/email.test.ts` | non-null assertions on `cmdArg.*` (×6) |
| `packages/notification-provider/src/build-provider.ts` | **New** — `buildNotificationProvider` |
| `packages/notification-provider/src/build-provider.test.ts` | **New** — factory unit tests |
| `packages/notification-provider/src/index.ts` | export `buildNotificationProvider` |
| `packages/orchestrator/src/cli-worker.ts` | `notification` factory delegates to shared builder |
| `packages/api-server/src/services/notify-on-terminal.ts` | delegate to shared builder; generic over all notification types |
| `packages/api-server/src/services/notify-on-terminal.test.ts` | add email case |
| `packages/core/src/registries/provider-catalog.ts` | slack `implemented: true` |
| `CLAUDE.md` | mark `SlackProvider` implemented |

No DB migrations. No `@journeyman/core` type changes.

---

## 6. Out of Scope

- Slack connection config UI (token vs. webhook selection) beyond what already exists.
- Agent notification channel/target redesign — current `agent.notifications.target` handling is
  kept as-is.
- New notification providers (Teams, Discord, etc.) — the factory makes them a one-line add.
