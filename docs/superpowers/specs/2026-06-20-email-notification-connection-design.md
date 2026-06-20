# Email Notification Connection Design

**Date:** 2026-06-20
**Status:** Approved

## Summary

Add `email` as a notification connection provider supporting five delivery methods: SMTP, Resend, SendGrid, Mailgun, and AWS SES. Follows the established Slack sub-method pattern (`config.method`) so no new architectural patterns are introduced.

---

## 1. Data Model

### Provider catalog

One new entry added to `PROVIDER_CATALOG` in `packages/core/src/registries/provider-catalog.ts`:

```ts
{ kind: "notification", value: "email", label: "Email", implemented: true }
```

The `Connection.provider` comment in `connection.types.ts` is updated to include `"email"`.

### Connection shape

`category: "notification"`, `provider: "email"`. The encrypted `credential` column holds the secret (SMTP password or API key). All non-secret fields go in the `config` JSONB column.

| Method | `config` fields | `credential` |
|---|---|---|
| `smtp` | `method`, `host`, `port` (number), `secure` (bool), `from`, `username` | SMTP password |
| `resend` | `method`, `from` | Resend API key |
| `sendgrid` | `method`, `from` | SendGrid API key |
| `mailgun` | `method`, `domain`, `from`, `region?` (`"us"` \| `"eu"`, default `"us"`) | Mailgun API key |
| `ses` | `method`, `region`, `from`, `accessKeyId` | AWS secret access key |

`ResolvedConnection` (`id`, `category`, `provider`, `credential`, `baseUrl?`, `config?`) already carries all needed fields — no type changes required.

---

## 2. `EmailProvider` Implementation

**Location:** `packages/notification-provider/src/providers/email/index.ts`

### Options type

Discriminated union on `method`, constructed from `ResolvedConnection`:

```ts
export type EmailProviderOptions =
  | { method: "smtp";     host: string; port: number; secure: boolean; from: string; username: string; password: string }
  | { method: "resend";   from: string; apiKey: string }
  | { method: "sendgrid"; from: string; apiKey: string }
  | { method: "mailgun";  from: string; domain: string; apiKey: string; region?: "us" | "eu" }
  | { method: "ses";      from: string; region: string; accessKeyId: string; secretAccessKey: string }
```

### `send()` mapping

`SendNotificationOptions.channel` → recipient `to` address. `opts.title` → email subject (falls back to `"Notification"` if absent). `opts.message` → plain-text body.

| Method | Transport |
|---|---|
| `smtp` | `nodemailer` — `createTransport` + `sendMail` |
| `resend` | `POST https://api.resend.com/emails` with `Authorization: Bearer <key>` |
| `sendgrid` | `POST https://api.sendgrid.com/v3/mail/send` with `Authorization: Bearer <key>` |
| `mailgun` | `POST https://api{.eu}.mailgun.net/v3/{domain}/messages` with HTTP Basic `api:<key>` |
| `ses` | `@aws-sdk/client-ses` — `SESClient` + `SendEmailCommand` |

`nodemailer` and `@aws-sdk/client-ses` are added as dependencies of `notification-provider`. The three HTTP-based methods use the global `fetch` (Node 18+, already in use elsewhere).

### Factory wiring

The `ProviderFactory<INotificationProvider>` in `packages/orchestrator/src/workers/worker-harness.ts` already receives a `ResolvedConnection` when building a notification provider. The `email` branch reads `connection.config.method` to select the sub-type and maps `connection.credential` to the appropriate secret field.

### Export

`EmailProvider` exported from `packages/notification-provider/src/index.ts` alongside `SlackProvider` and `ConsoleProvider`.

---

## 3. Connection Test Endpoint

`POST /workspaces/:wsId/connections/:id/test` currently stubs notification connections. With this design it performs a lightweight credential check per method:

| Method | Check |
|---|---|
| `smtp` | Open TCP connection to `host:port`, read the SMTP greeting banner (no message sent) |
| `resend` | `GET https://api.resend.com/domains` — returns 200 on valid key |
| `sendgrid` | `GET https://api.sendgrid.com/v3/user/profile` — returns 200 on valid key |
| `mailgun` | `GET https://api{.eu}.mailgun.net/v3/domains/{domain}` — returns 200 on valid key + domain |
| `ses` | `SESClient.send(new GetSendQuotaCommand())` — succeeds on valid credentials |

All return `{ ok: boolean, note?: string, error?: string }` matching the existing test response shape.

---

## 4. UI — `ConnectionsPage` (`AddConnectionModal`)

**File:** `packages/web/src/routes/ConnectionsPage.tsx`

### Changes

1. Add `"email"` to the notification provider `<option>` list.
2. When `category === "notification" && provider === "email"`, render:
   - A **Method** `<select>` with options: `smtp`, `resend`, `sendgrid`, `mailgun`, `ses`.
   - A **From address** field (all methods).
   - Method-specific fields (shown only for the selected method):
     - `smtp`: Host, Port (number input, default 587), Secure TLS (checkbox), Username
     - `mailgun`: Domain, Region (us / eu, default us)
     - `ses`: Region, Access Key ID
3. The credential label changes per method: `"Password"` for `smtp`, `"Secret access key"` for `ses`, `"API key"` for the rest.
4. `config` sent to the API: `{ method, from, ...method-specific non-secret fields }`.

### Validation (Connect button disabled until)

| Condition | Methods |
|---|---|
| `label`, `from`, `credential` filled | All |
| `host`, `port`, `username` filled | smtp |
| `domain` filled | mailgun |
| `region`, `accessKeyId` filled | ses |

### Default state

When the user switches category to `notification` and provider to `email`, `method` defaults to `"smtp"`.

---

## 5. Affected Files

| File | Change |
|---|---|
| `packages/core/src/registries/provider-catalog.ts` | Add `email` entry |
| `packages/core/src/types/connection.types.ts` | Update provider comment |
| `packages/notification-provider/src/providers/email/index.ts` | New — `EmailProvider` |
| `packages/notification-provider/src/index.ts` | Export `EmailProvider` |
| `packages/notification-provider/package.json` | Add `nodemailer`, `@aws-sdk/client-ses` deps |
| `packages/orchestrator/src/workers/worker-harness.ts` | Wire `email` branch in notification factory |
| `packages/api-server/src/routes/connections.ts` | Implement email test in `testNotificationConnection` |
| `packages/web/src/routes/ConnectionsPage.tsx` | Add email provider + method sub-form |

No DB migrations required — `config` is already JSONB and `provider` is a free-form string.
