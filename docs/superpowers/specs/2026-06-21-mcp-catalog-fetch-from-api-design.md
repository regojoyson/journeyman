# MCP Catalog — Single Backend Store, Frontend Fetches via API

**Date:** 2026-06-21
**Status:** Approved (design)

## Problem

The static catalog of well-known MCP servers (the "Add MCP from catalog" list)
is duplicated. The same ~250-line array exists in two places that must be edited
in lockstep:

- `packages/mcp/src/routes/catalog.ts` — backend `CATALOG`, served at `GET /api/mcp-catalog`.
- `packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts` — frontend `defaultMcpCatalog`, imported synchronously and passed into the flow-editor canvas.

The backend cannot import the frontend (that would pull React/JSX into the
server build and break import boundaries), which is why a second copy was kept
on the frontend. Any drift means the canvas picker and the API serve different
catalogs.

Note the asymmetry that makes this easy to fix: the **web** "Add from catalog"
modal (`AddFromCatalogModal`) already consumes the catalog over the API via
`mcpApi.listCatalog()`. Only the **flow-editor canvas** still relies on the
static copy.

## Goal

Make the backend catalog the single source of truth and have the frontend canvas
fetch it from the existing API, eliminating the duplicate data array — without
changing the API contract.

## Approach: backend route is the store; frontend fetches it

The backend `CATALOG` in `packages/mcp/src/routes/catalog.ts` is treated as the
one and only data source. It is already exposed by `GET /api/mcp-catalog`
(global, unauthenticated, returns the static array). The frontend canvas stops
importing its own copy and instead fetches this endpoint, the same way the web
modal already does.

### Why this over moving the catalog into `@journeyman/core`

A shared `core` constant was considered and rejected in favor of this approach
because:

- The backend route is a genuine store + API, not just a shared literal. If the
  catalog ever becomes DB-backed or dynamic, the frontend **already fetches it**
  and needs no rework.
- It drops ~250 lines of data from the frontend bundle instead of shipping it.
- The plumbing is near-zero: `FlowEditorPage` already uses react-query with a
  loading gate, and the `mcpCatalog` prop is already optional with an `?? []`
  fallback downstream.

The accepted trade-off: the canvas MCP picker becomes network-dependent (empty
for the brief moment before the fetch resolves, or if the API errors) instead of
instant. This matches existing behavior — the web modal is already API-driven
and silently falls back to `[]` on error — so it is consistent with the app
rather than a new pattern. No hardcoded fallback will be kept, because that would
re-introduce a (smaller) duplicate.

## Design

### 1. Backend — unchanged

`CATALOG` and `registerMcpCatalogRoute` (`GET /api/mcp-catalog`) stay exactly as
they are. This is the store. The response shape does not change.

### 2. Frontend canvas fetches the catalog

In `packages/web/src/routes/FlowEditorPage.tsx`:

- Add a react-query query for the catalog, alongside the existing `flowQ` /
  `versionsQ` queries, calling `mcpApi.listCatalog()`.
- Pass its result into `<FlowEditor mcpCatalog={…} />` instead of the static
  import. While loading, pass `[]` (the prop and all downstream consumers
  already tolerate an empty array, so the existing "Loading editor…" gate does
  not need to block on the catalog).

`mcpApi.listCatalog()` already exists in `packages/web/src/api/mcp.ts`. The
redundant `catalog()` alias method may be removed as cleanup, leaving a single
`listCatalog()`.

### 3. Delete the duplicate data

- Remove `packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts` (the static
  array).
- Remove the `defaultMcpCatalog` export from `packages/flow-editor/src/index.ts`.
- Remove the re-export at `packages/web/src/catalogs/built-in-mcp-catalog.ts` and
  the static import in `FlowEditorPage.tsx`.

### 4. Type consolidation (frontend side)

- `packages/flow-editor/src/types.ts` keeps `McpCatalogEntry` / `McpCatalog` as
  **pure types** — they are the `mcpCatalog` prop contract for the canvas. No
  data, just the shape.
- `packages/web/src/api/mcp.ts` replaces its structurally-identical
  `CatalogEntry` interface with `McpCatalogEntry` imported from
  `@journeyman/flow-editor` (web already depends on flow-editor). Alias on import
  if needed to avoid touching call sites.
- The backend's inline `McpCatalogEntry` in `catalog.ts` stays as-is. It is the
  server side of an HTTP boundary; the backend and frontend cannot import each
  other, and an independent type on each side of an API is conventional, not a
  smell.

## Data flow

```
packages/mcp/src/routes/catalog.ts   (CATALOG — the single store)
        │
        └── GET /api/mcp-catalog  (existing, unchanged)
              ├── web AddFromCatalogModal      (already fetches — unchanged)
              └── web FlowEditorPage (useQuery) ──> <FlowEditor mcpCatalog> ──> PropertiesPanel ──> ConfigTab picker
```

One data source; both frontend surfaces reach it through the same endpoint.

## Components & boundaries

| Unit | Purpose | Depends on |
|---|---|---|
| `mcp/routes/catalog.ts` | The store + HTTP endpoint | — (unchanged) |
| `web/api/mcp.ts` | Typed client fetch (`listCatalog`) | flow-editor (type only) |
| `web/routes/FlowEditorPage.tsx` | Fetch catalog, pass as prop | mcp api, flow-editor |
| `flow-editor` | Render picker from the `mcpCatalog` prop (pure type, no data) | core (`McpTransport`) |

## Error handling

- API error or slow network: the canvas picker renders with an empty catalog,
  consistent with the web modal's existing `.catch(() => setCatalog([]))`
  behavior. No crash; the user simply sees no catalog entries until the fetch
  succeeds.
- No new server-side failure modes — the route is unchanged.

## Testing / verification

- `npm run check` (typecheck + import boundaries) must pass — confirms the
  removed static import has no stragglers and no illegal cross-package imports.
- `GET /api/mcp-catalog` returns the identical JSON it returns today.
- In the running app: open the flow editor, select a custom-AI node, and confirm
  the MCP picker lists every catalog entry (including `resend` and `smtp`),
  grouped by category — now sourced from the API.
- The "Add MCP from catalog" modal continues to work unchanged.
- Grep confirms no remaining `defaultMcpCatalog` definition/import and no second
  catalog data array on the frontend.

## Out of scope

- No changes to MCP resolution, secret binding, or runtime spawning.
- No changes to catalog contents beyond removing the duplicate.
- Making the backend catalog DB-backed/dynamic — this design only positions the
  frontend to consume it via API; the store stays a static array for now.
- The Slack entry's hosted-OAuth-vs-static-token limitation is unrelated and
  untouched.
