# Webhook Test Payload — Sample & Schema Skeleton

**Date:** 2026-05-25
**Status:** Draft
**Scope:** `packages/web` (test panel UI), `packages/api-server` (preset detail endpoint), `packages/webhooks` (preset loader passthrough).

## Problem

The Webhook detail → Test tab lets users send a synthetic event through the ingest pipeline. Today it offers two inputs:

1. A dropdown of curated `samples/*.json` fixtures shipped with the preset.
2. A free-form JSON textarea ("custom payload") that overrides the sample.

Users want to start from a realistic payload and tweak it. The samples are good but only cover a few events per preset; users hitting an event with no sample have to author the JSON from scratch — even though every preset ships a `schema.json` describing the payload shape.

## Goal

Let the user pre-fill the editable textarea with either:

- **Load sample** — JSON of the currently-selected curated sample.
- **Generate from schema** — a skeleton synthesized from the preset's `schema.json`.

The user then edits the textarea and sends it. The existing send semantics are unchanged.

## Non-goals

- No schema *validation* of the edited payload before sending.
- No per-event sub-schemas. The preset's `schema.json` is a single envelope; we don't split it.
- No third-party schema-faker dependencies.

## UI Changes — [WebhookTestPanel.tsx](../../../packages/web/src/routes/webhooks/WebhookTestPanel.tsx)

- Keep the existing "Sample event from preset" dropdown as-is.
- Add two buttons above the custom-payload textarea:
  - **Load sample** — stringifies the currently-selected sample into the textarea.
  - **Generate from schema** — runs `skeletonFromSchema(schema)` and stringifies the result into the textarea.
- Both buttons overwrite the textarea unconditionally (no confirm). The textarea remains the source of truth for "Send test event".
- Hide **Load sample** when the preset has no samples (already the case for the dropdown).
- Hide **Generate from schema** when the preset has no schema (e.g., `generic`).

Send semantics unchanged: if `customPayload` is non-empty it is parsed and sent as `payload`; otherwise `sampleEvent: selected` is sent.

## Backend Changes — [webhook-presets.ts](../../../packages/api-server/src/routes/webhook-presets.ts)

`GET /presets/:id` (the route powering `getPresetDetail`) currently returns `samples`. Extend it to include `schema` (the parsed contents of the preset's `schema.json`), or `null` when the preset directory has no `schema.json`.

- Loader change in [packages/webhooks/src/presets/loader.ts](../../../packages/webhooks/src/presets/loader.ts): read `schema.json` alongside `samples/` when present.
- Response shape additions are additive — no client breakage.

## Schema → Skeleton Generator

New file: `packages/web/src/routes/webhooks/schema-skeleton.ts`.

Pure function `skeletonFromSchema(schema: unknown): unknown`. Recursive over the draft-07 JSON Schema subset actually used in the preset files:

| Schema construct | Output |
|---|---|
| `type: "object"` with `properties` | `{ [key]: skeleton(propSchema) }` for each declared property |
| `type: "object"` without `properties` | `{}` |
| `type: "array"` with `items` | `[skeleton(items)]` (length-1) |
| `type: "array"` without `items` | `[]` |
| `type: "string"` | `default` ?? `example` ?? `enum[0]` ?? `""` |
| `type: "integer"` / `"number"` | `default` ?? `0` |
| `type: "boolean"` | `default` ?? `false` |
| `type: "null"` | `null` |
| `oneOf` / `anyOf` / `allOf` | `skeleton(first variant)` |
| `$ref` | not used by current presets — return `null` and log a console warning |
| Unknown / missing `type` | `null` |

`additionalProperties: true` is ignored — only declared `properties` are emitted. No external deps.

## Edge Cases

- Preset with no schema → "Generate from schema" button hidden.
- Preset with no samples → dropdown and "Load sample" button hidden (already handled).
- Malformed schema → generator returns `null` and a non-blocking console warning; the button stays enabled but produces an empty skeleton.
- Schema with a top-level non-object type → emit whatever the generator returns (no special-case).

## Testing

- Unit tests for `skeletonFromSchema` covering each branch in the table above.
- One snapshot test per preset (`github`, `gitlab`, `bitbucket`, `jira`, `linear`, `monday`, `github-issues`, `github-projects`, `gitlab-issues`, `bitbucket-issues`) running the generator against the shipped `schema.json` — guards against schema changes.
- Verify output round-trips through `JSON.parse(JSON.stringify(...))`.

## Out of Scope / Future

- Schema validation of the edited payload before send.
- Smarter placeholder values (faker-style names, dates).
- Per-event branched schemas (would require restructuring `schema.json`).
