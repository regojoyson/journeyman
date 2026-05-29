# More Webhook Test Events — Design

**Date:** 2026-05-29

## Problem

The webhook "test event" panel has a dropdown of sample events to fire at a
webhook, but most provider presets ship only **one** sample — so the dropdown
looks nearly empty. Users want more sample events to test with, primarily for
**GitHub, Jira, and GitLab**.

A second, subtler problem: for **header-based** providers (GitHub, Bitbucket)
the event type is read from an HTTP header (`X-GitHub-Event`), but a test fire
sends only a JSON body and never sets that header. So GitHub test events arrive
with **no event type**, and a trigger's `listensFor` allowlist can't match them
in a test. Body-based providers (Jira `$.webhookEvent`, GitLab `$.object_kind`)
are unaffected because the type lives in the payload.

## Goal

1. Add a "common set" (~4–5 per provider) of realistic sample events for GitHub
   (code + issues), Jira, and GitLab, so the test dropdown is useful.
2. Make a test fire set the event-type header for header-based providers, so
   GitHub/Bitbucket test events resolve their event type and match `listensFor`.

## Non-Goals (YAGNI)

- Samples for every event in `knownEventTypes`. We add a common set, not an
  exhaustive one.
- Full vendor-fidelity payloads. Samples are compact but realistic — enough to
  exercise input mapping / `acceptIf`.
- Setting an event type for **custom free-text** payloads on header-based
  providers (the test panel's "paste your own JSON" path). That remains an
  existing limitation; out of scope.
- Generic/Bitbucket/monday/Linear sample expansion (not requested).

## How It Works Today

- Sample files live at `packages/webhooks/presets/<provider>/samples/*.json` and
  are declared in each `preset.json` under `sampleEvents` (key → relative path).
- The loader (`packages/webhooks/src/presets/loader.ts`) reads + `JSON.parse`s
  each file at startup into `LoadedPreset.samples` keyed by event name. A
  malformed sample throws at load time.
- The test panel (`packages/web/src/routes/webhooks/WebhookTestPanel.tsx`) lists
  the sample keys in a dropdown and POSTs to `/api/webhooks/:id/test`.
- The test route (`packages/api-server/src/routes/webhooks-management.ts`)
  resolves the chosen sample, synthesizes auth headers via
  `buildTestDeliveryHeaders`, and `app.inject()`s the body into the real ingest
  endpoint. Ingest derives the event type from the webhook's `eventTypePath`
  (`header:<name>` or a `$.body.path`).

## Part 1 — Sample Events (data)

Each addition is a new `samples/<key>.json` file plus one line in the preset's
`sampleEvents`. Keys must align with how the event type is read.

| Preset | Event-type source | Existing | Add |
|---|---|---|---|
| `github` (code) | `X-GitHub-Event` header | push, pull_request | **release, create, delete** |
| `github-issues` | `X-GitHub-Event` header | issues | **issue_comment** |
| `jira` | `$.webhookEvent` (body) | issue_updated | **issue_created, comment_created, issue_deleted** |
| `gitlab` (code) | `$.object_kind` (body) | push | **merge_request, pipeline, tag_push** |

Key/value rules:

- **GitHub** (header-based): the sample **key** equals the `X-GitHub-Event`
  value (`release`, `create`, `delete`, `issue_comment`). The header is set by
  Part 2 from the key.
- **Jira / GitLab** (body-based): the key is a friendly label, but the sample
  **body** must carry the real event-type value so it resolves and matches
  `knownEventTypes`:
  - Jira: `"webhookEvent": "jira:issue_created"` / `"comment_created"` /
    `"jira:issue_deleted"`.
  - GitLab: `"object_kind": "merge_request"` / `"pipeline"` / `"tag_push"`.

Payload content: compact but realistic — include the event-type field plus a
few representative fields the trigger might map or test against (e.g. issue key
+ title, MR id + state, ref/branch). Not full vendor payloads.

## Part 2 — Header Fix (code)

Single change in the test route `POST /api/webhooks/:id/test`
(`packages/api-server/src/routes/webhooks-management.ts`). After the sample
payload is resolved and `buildTestDeliveryHeaders` returns the header set, add
the event-type header when the provider reads it from a header and a sample key
was used:

```ts
// eventTypePath like "header:x-github-event" → set x-github-event = sampleEvent
if (body.sampleEvent && r.eventTypePath?.startsWith("header:")) {
  const h = r.eventTypePath.slice("header:".length).toLowerCase();
  headers[h] = body.sampleEvent;
}
```

`r` (the loaded webhook) already carries `eventTypePath`. Body-based providers
are untouched (their type is in the payload). Custom free-text payloads get no
event-type header (existing limitation).

## Edge Cases

- **Malformed sample JSON** — caught at preset load (the loader `JSON.parse`s
  every sample at startup), so a bad file fails fast rather than silently.
- **Sample key ≠ header value (GitHub)** — avoided by construction: GitHub keys
  are exactly the `X-GitHub-Event` values.
- **Body-based provider + header fix** — the guard only fires for
  `header:`-prefixed `eventTypePath`, so Jira/GitLab are unaffected.

## Testing

- **Loader smoke**: every preset loads and all samples parse (a single load of
  the preset registry exercises all new files; a malformed file throws).
- **Header derivation unit test**: `eventTypePath: "header:x-github-event"` +
  `sampleEvent: "release"` → header `x-github-event: release`; a body-based
  `eventTypePath` (`$.object_kind`) adds no header.
- **Manual**: select each new event in the dropdown, fire, confirm the run
  starts; for a GitHub webhook with a `listensFor` allowlist, confirm the test
  event now matches (resolves its type).

## Affected Files (summary)

| Responsibility | Path |
|---|---|
| New GitHub code samples + manifest | `packages/webhooks/presets/github/samples/*.json`, `preset.json` |
| New GitHub issue sample + manifest | `packages/webhooks/presets/github-issues/samples/issue_comment.json`, `preset.json` |
| New Jira samples + manifest | `packages/webhooks/presets/jira/samples/*.json`, `preset.json` |
| New GitLab samples + manifest | `packages/webhooks/presets/gitlab/samples/*.json`, `preset.json` |
| Event-type header on test fire | `packages/api-server/src/routes/webhooks-management.ts` |

## Constraints

- No commits during implementation.
- Run `npm run typecheck` as the final gate.
