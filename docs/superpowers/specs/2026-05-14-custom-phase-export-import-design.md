# Custom Phase Export / Import — Design

**Status:** Approved (brainstorming)
**Date:** 2026-05-14
**Owner:** samuel.rego@gocadmium.com

## Problem

Journeyman is deployed independently per environment. Custom AI phases authored in one deployment (e.g. dev) cannot today be moved to another (e.g. prod, or a customer environment). We want a portable representation so phases can be exchanged as files — exported from one system and imported into another — without copying database rows or sharing IDs.

## Goals

- Export a single custom phase as a JSON file from any Journeyman deployment.
- Import that file into another deployment (same or different org/user) and recreate the phase.
- Be forward-compatible: future schema changes must not silently corrupt older exports.
- Reuse existing validation. No parallel "import path" validation logic.

## Non-Goals

- Bulk / multi-phase export-import (single phase per file in v1).
- YAML support (JSON only).
- Carrying linked resources (MCP instances, Skills) along with the phase.
- Carrying secret values. Slots are exported as *definitions only*.
- Cross-version migration (only `schemaVersion: 1` is accepted in v1).

## Export shape

```json
{
  "schemaVersion": 1,
  "kind": "journeyman.customPhase",
  "exportedAt": "2026-05-14T12:00:00Z",
  "exportedFrom": "journeyman",
  "phase": {
    "name": "Analyze Repo",
    "description": "...",
    "inputFields": [ /* CustomPhaseInputField[] */ ],
    "outputMode": "structured",
    "outputSchema": { /* JSON Schema */ },
    "promptTemplate": "...",
    "defaultTools": [ /* CanonicalTool[] */ ],
    "defaultMcpIds": [],
    "defaultSkillIds": [],
    "requiresSkills": false,
    "requiresMcp": false,
    "slots": [ /* SecretSlotDef[] */ ]
  }
}
```

### Fields stripped on export

These are environment-specific or cross-system references that do not survive a move:

| Field | Reason |
|---|---|
| `id` | DB-generated per deployment. |
| `scope`, `userId`, `orgId` | Owner is decided at import time, not source time. |
| `createdBy`, `createdAt`, `updatedAt` | Audit fields, set fresh on import. |
| `defaultMcpIds` | IDs reference rows in the source MCP registry — meaningless elsewhere. Always emitted as `[]`. |
| `defaultSkillIds` | Same reasoning as `defaultMcpIds`. Always emitted as `[]`. |

The importer will need to re-wire `defaultMcpIds` / `defaultSkillIds` manually after import. This is intentional: independent deployments do not share MCP/Skill IDs, so name-matching would mostly miss and produce false hits. Hint-matching (e.g. exporting `defaultMcpNames` alongside `defaultMcpIds: []`) is a non-breaking enhancement we can add later if it proves needed.

### Carried as-is

- `slots` — `SecretSlotDef[]` are *names/types*, not credential values, so they are safe to export and re-import.
- `outputSchema` — arbitrary JSON Schema.
- `inputFields`, `promptTemplate`, `defaultTools`, `outputMode`, flags — pure phase definition.

### Header fields

- `schemaVersion: 1` — gates forward compatibility. Importer rejects anything other than `1` in v1.
- `kind: "journeyman.customPhase"` — guards against importing the wrong kind of file.
- `exportedAt`, `exportedFrom` — debugging hints; informational only, importer does not act on them.

## Code layout

- **`packages/core/src/types/custom-phases.types.ts`**
  - Add `CustomPhaseExportV1` interface.
  - Add `CUSTOM_PHASE_EXPORT_KIND = "journeyman.customPhase"` and `CUSTOM_PHASE_EXPORT_VERSION = 1` constants.

- **`packages/custom-phases/src/export.ts`** *(new)*
  - `toExportV1(phase: CustomAiPhase): CustomPhaseExportV1` — pure, picks portable fields, fills `[]` for stripped reference fields.
  - `fromExportV1(json: unknown): CustomAiPhaseCreateInput` — validates header, returns a create-input shaped object (scope and owner are supplied separately by the caller). Throws a typed error on bad header or shape.
  - No DB or HTTP concerns. Unit tested in isolation.

- **`packages/custom-phases/src/routes/user-custom-phases.ts`** and **`org-custom-phases.ts`**
  - `GET /:id/export` — loads phase, returns `toExportV1(phase)` JSON with `Content-Disposition: attachment; filename="<slug>.json"`.
  - `POST /import` — body is the raw export JSON. Steps:
    1. `fromExportV1(body)` → `CustomAiPhaseCreateInput`.
    2. Set `scope` + owner from the route's auth context (user route → `scope: "user"` + `userId`; org route → `scope: "org"` + `orgId`).
    3. Reuse the existing create validator / Zod schema from the `POST /` create route — same path, no duplicate validation.
    4. On name conflict within scope: respond `409` with `{ error: "name_conflict", existingId: "<id>" }`.
    5. On success: respond `201` with the created phase (same shape as `POST /`).

- **`packages/flow-editor`** — custom-phase management UI
  - "Export" button per phase: calls `GET /:id/export`, triggers browser download.
  - "Import" button: file picker → reads file → `POST /import`.
    - On `201`: refresh list, select the new phase.
    - On `409`: dialog with three actions — *Rename* (prompt for new name, retry with overwritten `phase.name`), *Overwrite* (`PATCH /:existingId` with the inner `phase` body), *Cancel*.
    - On any other 4xx/5xx: show the error message inline.

## Validation rules (import)

1. Header: `kind === "journeyman.customPhase"` AND `schemaVersion === 1`. Otherwise reject with a clear message naming the offending field.
2. Inner `phase` object: validated by the **same** Zod schema the create route uses. No second validator.
3. Name uniqueness within destination scope: enforced by the create path (already required by the existing schema/DB constraint). Surfaces as `409 name_conflict`.
4. `defaultMcpIds` / `defaultSkillIds`: ignored if non-empty in the import payload (defensive — older exports or hand-edited files). Set to `[]` before validation.

## Out of scope (YAGNI)

- Bulk export/import.
- Embedding referenced MCPs/Skills in the export.
- YAML.
- Schema migrations (v2 → v1, etc.). When v2 ships, add `migrate(json)` here; until then, v1 only.
- Sharing secret *values* — slots stay as definitions.

## Open follow-ups (not in v1)

- Optional `defaultMcpNames` / `defaultSkillNames` hint arrays to help importers match by name. Backwards-compatible to add later (additive fields).
- Bulk export of all phases in a scope (`GET /export-all`).
- Signed exports for provenance.
