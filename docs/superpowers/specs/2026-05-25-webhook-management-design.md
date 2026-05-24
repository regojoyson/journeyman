# Webhook Management — Design

**Date:** 2026-05-25
**Status:** Draft (approved direction; ready for implementation plan)
**Related:** [2026-05-24 Human Task & Webhook Split](2026-05-24-human-task-and-webhook-split-design.md), [2026-05-02 Webhook Event Tracking](2026-05-02-webhook-event-tracking-design.md)

## Problem

Today, inbound webhooks are baked into code. `POST /webhooks/:provider` accepts a
hardcoded list (`jira`, `github`, `monday`, `linear`) with per-provider parsing in
`packages/api-server/src/routes/webhooks.ts`. Adding a new system — Bitbucket,
Notion, ServiceNow, or any internal app — requires editing that router, redeploying,
and shipping new types. Webhook secrets live inside per-provider configs with no
unified lifecycle (rotate, revoke, audit), and signature verification is partly
documented but not actually implemented at the ingest layer.

The system is also single-tenant by URL: every org hits the same
`/webhooks/github`, so there is no clean way to know which tenant's secret a
request belongs to, and no per-org isolation of credentials or events.

## Decision

Promote **Webhook** to a first-class resource — owned by an org or user, managed
through CRUD and a UI page, decoupled from provider-specific code. Flow nodes
(`webhook-wait`, `webhook-trigger`) reference a webhook by id. A library of
presets ships in the box so users don't write JSON Schema for known systems, and
`generic` covers everything else.

The router becomes a thin lookup over the registry. Adding a new system =
authoring one preset JSON file. No code change, no redeploy.

## Out of scope (deferred)

- **Outbound webhooks** (Journeyman → external). Different problem, same name.
- **Payload transformers / scripting on ingest.** `fromPath` + JSONLogic covers
  the working cases; transformers added only when a real one demands them.
- **`webhook-trigger` node type for start-of-flow events.** Today's flow-level
  triggers continue to work; promoting them to a graph node is a follow-on
  design that re-uses the registry.
- **mTLS, IP allowlists, basic auth.** Defer to v2 unless a real customer needs
  them.
- **Webhook dashboards / volume analytics.** v1 ships a basic recent-events
  tail; full dashboards later.

## The Webhook resource

```ts
type Webhook = {
  id: string;
  scope: { orgId: string } | { userId: string };
  name: string;                       // "Acme GitHub prod"
  description?: string;
  preset: PresetId;                   // "github" | "github-issues" | ... | "generic"
  kind: "ticket" | "git";             // derived from preset; user-set on "generic"

  tenantToken: string;                // random, appears in the ingest URL path
  ingestUrl: string;                  // derived: POST /webhooks/in/:tenantToken

  auth: WebhookAuthConfig;            // see "Security modes" below

  payloadSchema?: JSONSchema;         // optional; enables autocomplete + validation
  schemaValidation: "off" | "warn" | "reject";   // default "off" in v1
  schemaInferredFrom?: string;        // stored sample, for "regenerate from sample"

  eventTypePath?: string;             // "header:x-github-event" | "$.webhookEvent" | ...
  deliveryIdHeader?: string;          // for dedup

  correlationSuggestions?: Array<{
    key: string;                      // "issueRef" | "commitSha" | "branch" | custom
    path: string;                     // dot-path or expression
  }>;

  createdAt: string;
  updatedAt: string;
  rotatedAt?: string;
  lastEventAt?: string;
};
```

Secrets (HMAC keys, bearer tokens, JWT signing keys) live in
`@journeyman/secrets`, referenced from `auth` via `*Ref` fields — never inlined.

### Database

One new table: `jm_webhooks`. Indexed on `tenantToken` (unique) and `(scope, kind)`.
Existing `jm_webhook_events` gains a nullable `webhook_id` foreign key so events
are attributable to their source.

## Ingest

A single route: `POST /webhooks/in/:tenantToken`.

1. Look up webhook by `tenantToken` → `404` if unknown.
2. Verify the request per the webhook's `auth` config (see Security below).
   Mismatch → `401`.
3. If `payloadSchema` is set and `schemaValidation = "reject"`, validate the
   body. Invalid → `400`.
4. Extract `eventType` per `eventTypePath`. Extract `deliveryId` per
   `deliveryIdHeader` if set.
5. Dedupe: if `(webhook_id, deliveryId)` already exists, return `200` with
   `status: "ignored"`. Do not reprocess.
6. Persist the event in `jm_webhook_events` with sanitized headers (auth and
   signature headers stripped before storage).
7. Match against paused `webhook-wait` nodes whose `webhookId` matches, whose
   `listensFor` allows this event type, and whose `acceptIf` passes. First
   match wins → resume the workflow with declared outputs filled.
8. Otherwise match against existing **flow-level webhook triggers** (the
   current start-of-flow trigger mechanism, now keyed by `webhookId` instead
   of `provider`).
9. Otherwise mark the event `ignored`.

Cross-cutting protections applied on every ingest regardless of auth mode:

- Body size cap (5 MB default; reject larger before parsing).
- Constant-time comparison (`crypto.timingSafeEqual`) for all signature/secret
  checks.
- Per-`tenantToken` soft rate limit (100 req/s sustained, 500 burst, returns
  `429`).
- Header sanitization on storage (strip `authorization`, all `*-signature*`,
  `cookie`).

The legacy `POST /webhooks/:provider` route stays in place as a thin alias:
it resolves to "the default webhook for this org+provider" and forwards into
the same pipeline. See **Migration** below.

## Security modes

Four auth modes ship in v1 (`none`, `header-equals`, `hmac`, `jwt`), with
HMAC supporting an optional timestamp sub-mode for replay protection. Together
they cover every preset and ~95% of `generic` use cases. The `auth`
discriminated union:

```ts
type WebhookAuthConfig =
  | { mode: "none" }
  | { mode: "header-equals"; header: string; valueRef: string }
  | {
      mode: "hmac";
      algo: "sha256" | "sha1" | "sha512";
      encoding: "hex" | "base64";
      header: string;
      prefix?: string;                       // "sha256=" etc.
      secretRef: string;
      timestamp?: {
        header: string;                      // "x-slack-request-timestamp"
        toleranceSeconds: number;            // default 300
        signedFormat: string;                // "{timestamp}.{body}"
      };
    }
  | {
      mode: "jwt";
      algo: "HS256" | "RS256" | "ES256";
      header: string;                        // default "authorization"
      stripPrefix?: string;                  // "Bearer "
      signingKeyRef?: string;                // HS256
      jwksUrl?: string;                      // RS256 / ES256
      expectedIssuer?: string;
      expectedAudience?: string;
    };
```

| Mode | Used by | Notes |
|---|---|---|
| `none` | dev/test, `generic` defaults | URL is the only secret — strongly discouraged for prod. |
| `header-equals` | GitLab (`X-Gitlab-Token`), Jira-bearer, internal systems | Plain token compare. Constant-time. |
| `hmac` | GitHub, Bitbucket, Linear, Shopify, Slack (with timestamp), Stripe (with timestamp) | Configurable algo / encoding / header / prefix; optional timestamp for replay protection. |
| `jwt` | Jira Connect, Monday, Atlassian apps | HS256 (shared) or RS256/ES256 via JWKS; verifies issuer/audience if configured. |

**Deferred (v2 or on demand):** Basic auth, mTLS (gateway-layer), IP allowlist,
AWS SNS subscription confirmation special-case.

## Preset library

Each preset is a JSON file in `packages/webhooks/presets/<id>/preset.json` with
a sibling `schema.json` and `samples/*.json`. Loaded at server startup; cached
in-process. Eleven presets ship in v1.

| Preset id | System | Kind | Auth default | Event-type source |
|---|---|---|---|---|
| `github` | GitHub | git | HMAC-SHA256 hex, `sha256=` | header `x-github-event` |
| `github-issues` | GitHub | ticket | HMAC-SHA256 hex, `sha256=` | header `x-github-event` |
| `github-projects` | GitHub | ticket | HMAC-SHA256 hex, `sha256=` | header `x-github-event` |
| `gitlab` | GitLab | git | header-equals `X-Gitlab-Token` | body `$.object_kind` |
| `gitlab-issues` | GitLab | ticket | header-equals `X-Gitlab-Token` | body `$.object_kind` |
| `bitbucket` | Bitbucket | git | HMAC-SHA256 hex, `sha256=` | header `x-event-key` |
| `bitbucket-issues` | Bitbucket | ticket | HMAC-SHA256 hex, `sha256=` | header `x-event-key` |
| `jira` | Jira Cloud | ticket | header-equals (Bearer) or JWT RS256 | body `$.webhookEvent` |
| `linear` | Linear | ticket | HMAC-SHA256 hex, no prefix | body `$.type` + `$.action` |
| `monday` | monday.com | ticket | JWT HS256 | body `$.event.type` |
| `generic` | Any | either | `none` (user picks) | user-supplied |

Each preset file shape (example for `github`):

```json
{
  "id": "github",
  "name": "GitHub (code events)",
  "kind": "git",
  "icon": "github.svg",
  "docsUrl": "https://docs.github.com/en/webhooks/webhook-events-and-payloads",

  "auth": {
    "mode": "hmac",
    "algo": "sha256",
    "encoding": "hex",
    "header": "x-hub-signature-256",
    "prefix": "sha256="
  },

  "eventTypePath": "header:x-github-event",
  "deliveryIdHeader": "x-github-delivery",

  "knownEventTypes": [
    "push", "pull_request", "pull_request_review",
    "create", "delete", "release", "workflow_run", "check_run"
  ],

  "correlationSuggestions": [
    { "key": "issueRef",  "path": "$.repository.full_name + '#' + $.pull_request.number" },
    { "key": "commitSha", "path": "$.after" },
    { "key": "branch",    "path": "$.ref" }
  ],

  "payloadSchemaRef": "./schema.json",

  "sampleEvents": {
    "push":         "./samples/push.json",
    "pull_request": "./samples/pull_request.json"
  }
}
```

### Why two presets for GitHub / GitLab / Bitbucket

The same provider sends very different payloads for code events vs issue events.
A unified schema would be a 30-variant union with useless autocomplete and a
single confusing event-type filter. Splitting them gives each preset a focused
schema, a focused event list, and focused correlation suggestions. Users
create two webhooks for the same repo (these providers support multiple
webhooks per repo).

### Schemas

- **GitHub:** vendored subset of GitHub's official OpenAPI webhook schemas.
- **GitLab / Bitbucket:** hand-written from reference docs, regen script in
  `scripts/`.
- **Jira / Linear / Monday:** hand-written from captured samples.
- **Generic:** none — user supplies.

All schemas are strict on the top-level envelope (fields flows actually
reference) and `additionalProperties: true` on nested objects so provider
changes don't break ingest.

## Schema authoring

Three paths in the "New Webhook" / "Edit Webhook" form:

1. **From a preset** — preset's `schema.json` is loaded automatically. Zero
   user effort.
2. **Infer from sample payload** — for `generic` (and any preset the user
   wants to override). User pastes a real event; Journeyman infers a draft
   schema (via `genson-js` or equivalent). User reviews and saves. The sample
   is stored in `schemaInferredFrom` so they can "regenerate" later.
3. **Hand-written** — Monaco editor with JSON Schema linting. Cannot save an
   invalid schema.

Schema is optional. Empty schema → no autocomplete, no publish-time validation,
no ingest validation — but ingest still works.

### What the schema enables

- **Autocomplete in `fromPath`** on `webhook-wait` outputs — dropdown is
  derived from the schema.
- **Publish-time validation** — every `fromPath` on every dependent node is
  checked against the schema. Missing fields fail publish with an actionable
  error.
- **Payload preview** — webhook detail page synthesizes an example from the
  schema for visual confirmation.
- **Optional ingest validation** — `schemaValidation` field, default `"off"`,
  can be raised to `"warn"` (tag event) or `"reject"` (return `400`).

## Flow integration

The `webhook-wait` node from
[the human-task / webhook split](2026-05-24-human-task-and-webhook-split-design.md)
gains a `webhookId` field:

```ts
type WebhookWaitConfig = {
  webhookId: string;                  // FK to jm_webhooks
  listensFor?: string[];              // event type allowlist
  correlation: { key: string; path?: string };
  acceptIf?: JsonLogic;
  outputs: Array<{
    name: string;
    type: FieldType;
    fromPath?: string;
    required?: boolean;
  }>;
  timeout?: { duration: string; defaults: Record<string, unknown> };
};
```

In the flow editor, the node config shows:

- **Webhook** — a dropdown of webhooks visible to the current scope (org-shared
  + user-private). Selected webhook drives the rest of the form.
- **Event types** — chips pulled from the webhook's `knownEventTypes`, free-form
  add allowed.
- **Accept if** — JSONLogic builder (same as If-Else gateway).
- **Correlation** — picker pre-populated from the webhook's
  `correlationSuggestions`, free-form override allowed.
- **Outputs** — fields with `fromPath` autocomplete fed by the webhook's schema.
- **Timeout** — same shape as today's human-task timeout.

A "Validate against schema" indicator on each `fromPath` field shows green /
amber / red as the user types.

## UI surface

A new sidebar item, **Webhooks**, sits next to **Flows** and **Secrets**. Two
tabs:

- **Organization** — shared webhooks visible across the org (RBAC: org admin
  to create/edit; member to read).
- **My webhooks** — user-private webhooks.

### List page

| Column | Notes |
|---|---|
| Name | + description tooltip |
| Preset | icon + label, e.g. "GitHub (code events)" |
| Kind | ticket / git pill |
| Ingest URL | masked + copy button |
| Last event | relative time |
| Used by | "N nodes across M flows" — click to drill in |
| Actions | edit, rotate secret, delete |

### Detail page

Tabs: **Overview**, **Schema**, **Recent events**, **Used by**.

- **Overview**: name, description, preset, ingest URL (copy), masked secret
  (one-time reveal on creation/rotation), auth config (read-only summary),
  "Send test event" button.
- **Schema**: read or edit. Monaco editor. Validation status.
- **Recent events**: last 50 events with timestamp, event type, delivery id,
  validation status (`ok` / `schema_invalid` / `auth_failed` / `ignored`).
  Click to see headers and body.
- **Used by**: list of `webhook-wait` and `webhook-trigger` nodes referencing
  this webhook with deep links to the flows.

### Test event

On the detail page, a "Send test event" panel lets the user POST a sample
payload (from the preset's samples or pasted) to the ingest URL **with a
synthetic valid signature** (using the stored secret). The result — verified
status, matched waiters, would-trigger flows — is shown inline.

## API

Under `/api/orgs/:orgId/webhooks` and `/api/users/me/webhooks`:

| Method | Path | Notes |
|---|---|---|
| `GET`    | `/`              | list, paginated |
| `POST`   | `/`              | create (server generates `tenantToken`, mints `secretRef`) |
| `GET`    | `/:id`           | full detail |
| `PATCH`  | `/:id`           | partial update; restricted fields (`scope`, `tenantToken`) immutable |
| `POST`   | `/:id/rotate`    | mint a new secret; returns once |
| `POST`   | `/:id/test`      | run synthetic verified delivery |
| `DELETE` | `/:id`           | soft-delete if referenced by any node; hard-delete otherwise |

Plus a global registry endpoint for the UI:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/webhook-presets` | static catalog (id, name, kind, icon, docs url) |

Ingest endpoints:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/webhooks/in/:tenantToken` | the new universal route |
| `POST` | `/webhooks/:provider`       | legacy alias, resolves to a default webhook per org+provider |

## Migration

### Data migration

A one-time SQL migration creates `jm_webhooks` and adds `webhook_id` to
`jm_webhook_events`. For every org that has used webhooks, a **default
webhook per provider** is auto-provisioned with:

- `name`: `"Default <Provider>"`.
- `preset`: matching id.
- `tenantToken`: newly generated.
- `auth`: matched from preset defaults; `secretRef` points to the org's
  existing per-provider secret (no re-entry needed).
- `payloadSchema`: from preset.

The legacy `POST /webhooks/:provider` route now resolves to that default
webhook, so existing GitHub/Jira/etc. configurations keep working without
re-pasting URLs.

### Flow migration

Existing `webhook-wait` nodes lack `webhookId`. At workflow read time,
nodes are auto-bound to the default webhook for their `provider` field
(same loader-migration pattern used for human-task / webhook-wait split).
Stored definitions are rewritten on next save.

### Communication

A banner on the new Webhooks page on first visit explains that legacy
webhooks have been auto-migrated and recommends rotating the secret + URL
to per-tenant tokens at the user's convenience.

## Code structure

### New package: `@journeyman/webhooks`

```
packages/webhooks/
├── presets/
│   ├── github/{preset.json,schema.json,samples/*.json}
│   ├── github-issues/...
│   ├── github-projects/...
│   ├── gitlab/...
│   ├── gitlab-issues/...
│   ├── bitbucket/...
│   ├── bitbucket-issues/...
│   ├── jira/...
│   ├── linear/...
│   ├── monday/...
│   └── generic/preset.json
├── src/
│   ├── index.ts
│   ├── presets/loader.ts          // load + cache preset files
│   ├── auth/
│   │   ├── verify.ts              // dispatch on auth.mode
│   │   ├── hmac.ts
│   │   ├── header-equals.ts
│   │   ├── jwt.ts
│   │   └── timing-safe.ts
│   ├── schema/
│   │   ├── infer.ts               // sample → JSON Schema
│   │   ├── validate.ts
│   │   └── lint.ts                // schema-of-schemas check
│   ├── extract/
│   │   ├── event-type.ts          // "header:..." | "$.path" | expression
│   │   └── path.ts                // shared dot-path / JSONPath helper
│   └── types.ts
└── package.json
```

### `@journeyman/core`

- `webhook.types.ts` — `Webhook`, `WebhookAuthConfig`, `PresetId`,
  `WebhookEvent` (extended with `webhook_id`).
- `interfaces/webhook-store.interface.ts` — `IWebhookStore` (CRUD + lookup
  by token).

### `@journeyman/api-server`

- New routes: `routes/webhooks-management.ts` (CRUD), `routes/webhook-presets.ts`.
- `routes/webhooks.ts` rewritten to:
  - Primary handler at `/webhooks/in/:tenantToken` using `@journeyman/webhooks`.
  - Legacy `/webhooks/:provider` shim that resolves to the org's default
    webhook for that preset.
- New service: `services/webhook-test-delivery.ts` (synthetic signed POST
  to own ingest).

### `@journeyman/flow-editor`

- `WebhookWaitConfigEditor.tsx` extended with the webhook dropdown,
  schema-driven `fromPath` autocomplete, correlation picker, validation
  indicators.
- New page module `@journeyman/webhooks-ui` (or inside `@journeyman/web`):
  list, detail, create wizard with preset gallery, schema editor.

### `@journeyman/migrations`

- New SQL migration `019_webhooks.sql`:
  - `CREATE TABLE jm_webhooks (...)`.
  - `ALTER TABLE jm_webhook_events ADD COLUMN webhook_id UUID REFERENCES jm_webhooks(id)`.
  - Data backfill: provision default webhooks per (org, provider) pair
    that has existing events; backfill `webhook_id` on existing events.

### `@journeyman/secrets`

- No code changes. Webhook auth references existing secret slots.

## Testing strategy

- **Auth modules** — unit tests per mode: valid signature passes, bad
  signature fails, missing header fails, timing-safe-compare confirmed.
  Replay (timestamp out of tolerance) rejected.
- **Preset loader** — every shipped preset loads, validates its own schema,
  and parses a real sample event.
- **Schema inference** — golden tests on representative samples.
- **Ingest flow** — integration tests against an in-process Fastify app:
  preset webhook receives a real GitHub sample, signature verifies, event
  stored, matching `webhook-wait` resumes.
- **Dedup** — same delivery id twice → second is `ignored`.
- **Legacy compat** — `POST /webhooks/github` resolves to default webhook
  and behaves identically to existing tests.
- **Migration** — apply migration on a snapshot DB with existing events;
  verify default webhooks are provisioned and events get `webhook_id` filled.
- **Editor** — component tests for the webhook picker, schema-driven
  autocomplete, publish-time validation.

## Acceptance criteria

- A user can create a webhook from the Webhooks page, pick a preset
  (e.g. GitHub-code), receive a unique ingest URL and a one-time secret,
  paste both into GitHub, and see real events arrive within the test panel.
- A user can create a `generic` webhook, paste a sample payload, accept the
  inferred schema, and immediately wire a flow's `webhook-wait` node to it
  with `fromPath` autocomplete working.
- A `webhook-wait` node references a webhook by id, and changing the webhook's
  schema reflects in the editor without redeploy.
- HMAC, header-equals, and JWT verification all pass conformance tests with
  recorded real samples from GitHub, GitLab, Jira (Connect), Linear, and
  Monday.
- Existing flows using legacy `POST /webhooks/:provider` continue to work
  unchanged; the legacy route resolves to per-org default webhooks created
  by the migration.
- Rotating a webhook's secret takes effect on the next request; old secret
  immediately invalid.
- A webhook cannot be deleted while referenced by any node (UI warns; API
  returns `409`).

## Open questions (resolve during planning)

1. **Preset versioning.** When we update a shipped schema (e.g. GitHub adds a
   new field), do webhooks created from older preset versions auto-upgrade?
   Proposal: each webhook stores `presetVersion`; admin can "upgrade
   schema" with a diff view. Defer mechanism to v1.1 if planning gets tight.
2. **JWKS caching policy** for JWT modes (Jira Connect). Proposal: in-memory
   cache, 1h TTL, refresh on key-id miss.
3. **Where the legacy-route shim lives** — same Fastify route file, or a
   small adapter package consumed by it? Decide during planning based on
   test ergonomics.
4. **Multi-secret HMAC** for graceful rotation (accept either the current
   or previous secret during a grace window). Nice-to-have; default to
   single-secret in v1 unless cheap.
