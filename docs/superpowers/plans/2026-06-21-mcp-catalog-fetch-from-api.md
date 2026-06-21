# MCP Catalog — Fetch From API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the backend `GET /api/mcp-catalog` route the single source of the MCP catalog, and have the flow-editor canvas fetch it instead of importing a duplicate static copy.

**Architecture:** The backend `CATALOG` array in `packages/mcp/src/routes/catalog.ts` stays as the one store and is already exposed via `GET /api/mcp-catalog`. The web `FlowEditorPage` fetches it with react-query and passes it into `<FlowEditor>`; the ~250-line static `defaultMcpCatalog` on the frontend is deleted. The catalog entry type is consolidated so `web` reuses `@journeyman/flow-editor`'s `McpCatalogEntry`.

**Tech Stack:** TypeScript, React, `@tanstack/react-query`, npm workspaces monorepo. Verified by `npm run typecheck`.

**Execution constraints (per request):** Work on the `master` branch. **No commits.** No per-task test scaffolding. A single `npm run typecheck` runs at the very end as the verification gate (plus grep checks).

---

## File Structure

| File | Change | Responsibility after change |
|---|---|---|
| `packages/mcp/src/routes/catalog.ts` | Modify (comment only) | The single catalog store + `GET /api/mcp-catalog` (data unchanged) |
| `packages/web/src/api/mcp.ts` | Modify | `CatalogEntry` becomes an alias of flow-editor's `McpCatalogEntry`; drop redundant `catalog()` method |
| `packages/web/src/routes/FlowEditorPage.tsx` | Modify | Fetch catalog via react-query, pass into `<FlowEditor>` |
| `packages/web/src/catalogs/built-in-mcp-catalog.ts` | Delete | (was a re-export of the duplicate) |
| `packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts` | Delete | (was the duplicate ~250-line data array) |
| `packages/flow-editor/src/index.ts` | Modify | Drop the `defaultMcpCatalog` data export; keep the `McpCatalog`/`McpCatalogEntry` type exports |
| `packages/flow-editor/src/types.ts` | Unchanged | Still defines `McpCatalogEntry`/`McpCatalog` as pure types (the prop contract) |

---

### Task 1: Consolidate the catalog entry type in the web API client

Replace the duplicate `CatalogEntry` interface in the web MCP API client with an alias of `@journeyman/flow-editor`'s `McpCatalogEntry`, and remove the unused `catalog()` method. This keeps every existing `CatalogEntry` consumer (e.g. `AddFromCatalogModal.tsx`) working unchanged while eliminating one type copy.

**Files:**
- Modify: `packages/web/src/api/mcp.ts`

- [ ] **Step 1: Replace the `CatalogEntry` interface with a type alias**

In `packages/web/src/api/mcp.ts`, the current interface (lines 21-32) is:

```typescript
export interface CatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
  category?: string;
}
```

Replace it with a re-exported alias of the flow-editor type:

```typescript
export type CatalogEntry = McpCatalogEntry;
```

- [ ] **Step 2: Add the import for `McpCatalogEntry`**

At the top of `packages/web/src/api/mcp.ts`, add an import from the flow-editor package (web already depends on `@journeyman/flow-editor`). Place it as the first import line:

```typescript
import type { McpCatalogEntry } from "@journeyman/flow-editor";
```

- [ ] **Step 3: Remove the redundant `catalog()` method**

`mcpApi.catalog()` (lines 114-115) is a duplicate of `listCatalog()` and has zero callers (verified: the only `.catalog()` caller in the web app is `skillsApi.catalog()`, which is unrelated). Delete this method and the trailing comma fix so the object ends cleanly. The `catalog()` entry to delete:

```typescript
  catalog: () =>
    fetch("/api/mcp-catalog", { credentials: "include" }).then(jsonOrThrow<CatalogEntry[]>),
```

After deletion, `listCatalog` (lines 96-97) remains and is the single catalog fetch:

```typescript
  listCatalog: () =>
    fetch("/api/mcp-catalog", { credentials: "include" }).then(jsonOrThrow<CatalogEntry[]>),
```

Ensure the method immediately preceding the closing `};` of the `mcpApi` object (now `testInvoke`) ends with a comma and the object closes correctly.

---

### Task 2: Fetch the catalog in `FlowEditorPage` and pass it to `<FlowEditor>`

Replace the static `defaultMcpCatalog` import with a react-query fetch of the existing endpoint, joining the page's existing query pattern. While the fetch is in flight, pass `[]` (the `mcpCatalog` prop and all downstream consumers already tolerate an empty array, so the existing "Loading editor…" gate need not block on it).

**Files:**
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`

- [ ] **Step 1: Remove the static catalog import (line 12)**

Delete this line from `packages/web/src/routes/FlowEditorPage.tsx`:

```typescript
import { defaultMcpCatalog } from "../catalogs/built-in-mcp-catalog.ts";
```

- [ ] **Step 2: Import the MCP API client**

Add this import alongside the other `../api/*` imports near the top of the file (e.g. directly after the `../api/workflow-triggers.ts` import on line 8):

```typescript
import { mcpApi } from "../api/mcp.ts";
```

- [ ] **Step 3: Add a react-query query for the catalog**

In the component body, directly after the `versionsQ` query (currently lines 43-47), add:

```typescript
  const catalogQ = useQuery({
    queryKey: ["mcp-catalog"],
    queryFn: () => mcpApi.listCatalog(),
  });
```

- [ ] **Step 4: Pass the fetched catalog into `<FlowEditor>`**

Change the `mcpCatalog` prop (currently line 184) from:

```typescript
            mcpCatalog={defaultMcpCatalog}
```

to:

```typescript
            mcpCatalog={catalogQ.data ?? []}
```

Note on types: after Task 1, `listCatalog()` returns `CatalogEntry[]` which is now an alias for `McpCatalogEntry[]` (= `McpCatalog`), exactly the type the `mcpCatalog` prop expects, so this assignment type-checks with no cast.

---

### Task 3: Delete the duplicate frontend catalog data

Remove the static catalog array and the two export/re-export hops that fed it. The type definitions in `flow-editor/src/types.ts` stay — only the **data** is removed.

**Files:**
- Delete: `packages/web/src/catalogs/built-in-mcp-catalog.ts`
- Delete: `packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts`
- Modify: `packages/flow-editor/src/index.ts`

- [ ] **Step 1: Delete the web re-export file**

Delete `packages/web/src/catalogs/built-in-mcp-catalog.ts` entirely. Its full current contents are just:

```typescript
export { defaultMcpCatalog } from "@journeyman/flow-editor";
```

Run:

```bash
rm packages/web/src/catalogs/built-in-mcp-catalog.ts
```

- [ ] **Step 2: Delete the flow-editor static data file**

Delete `packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts` entirely (the ~250-line `defaultMcpCatalog` array).

Run:

```bash
rm packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts
```

- [ ] **Step 3: Remove the data export from the flow-editor barrel**

In `packages/flow-editor/src/index.ts`, delete line 27:

```typescript
export { defaultMcpCatalog } from "./catalogs/built-in-mcp-catalog.ts";
```

Leave the type exports on lines 8-12 intact — in particular `McpCatalog, McpCatalogEntry` from `./types.ts` must remain exported, because Task 1's `import type { McpCatalogEntry } from "@journeyman/flow-editor"` depends on them.

---

### Task 4: Update the stale comment in the backend catalog store

The backend file's header comment says it "Mirrors the entries available in `@journeyman/flow-editor`'s `defaultMcpCatalog`" — that export no longer exists after Task 3, and the relationship has inverted (the frontend now fetches from this route). Update the comment to describe reality.

**Files:**
- Modify: `packages/mcp/src/routes/catalog.ts`

- [ ] **Step 1: Replace the header comment**

In `packages/mcp/src/routes/catalog.ts`, the current comment (lines 3-11) reads:

```typescript
/**
 * Static catalog of well-known MCP servers. Mirrors the entries available in
 * `@journeyman/flow-editor`'s `defaultMcpCatalog`, but lives here to avoid
 * pulling JSX-bearing flow-editor sources into the server-side typecheck.
 *
 * The "Add MCP from catalog" UI calls `GET /api/mcp-catalog` and uses the
 * returned entries to pre-fill the create form. The optional `category` field
 * powers grouping/filtering in the picker.
 */
```

Replace it with:

```typescript
/**
 * The single source of truth for the static catalog of well-known MCP servers.
 * Served verbatim by `GET /api/mcp-catalog`.
 *
 * Both frontend surfaces consume this endpoint: the "Add MCP from catalog"
 * modal and the flow-editor canvas's MCP picker (via `FlowEditorPage`). The
 * frontend no longer keeps its own copy of this data. The optional `category`
 * field powers grouping/filtering in the picker.
 */
```

Leave the inline `McpCatalogEntry` interface and the `CATALOG` array below it unchanged — this is the server side of the HTTP boundary and is intentionally independent of the frontend type.

---

### Task 5: Verify — typecheck and confirm no stragglers

**Files:** none (verification only)

- [ ] **Step 1: Confirm the duplicate data and dead references are gone**

Run:

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
grep -rn "defaultMcpCatalog" packages --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Expected: **no output** (every reference removed — definition, both exports, the re-export, and the `FlowEditorPage` usage).

- [ ] **Step 2: Confirm no second catalog data array remains on the frontend**

Run:

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
ls packages/flow-editor/src/catalogs/built-in-mcp-catalog.ts packages/web/src/catalogs/built-in-mcp-catalog.ts 2>&1
```

Expected: both paths report "No such file or directory".

- [ ] **Step 3: Run the typecheck (the verification gate)**

Run:

```bash
cd /Users/admin/data/workspace/claude-skils/journeyman
npm run typecheck
```

Expected: completes with no TypeScript errors across all workspaces (each package prints `> tsc --noEmit` with no error output). If `FlowEditorPage.tsx` reports a type mismatch on `mcpCatalog`, confirm Task 1 made `CatalogEntry = McpCatalogEntry` (not a separate interface) and that `@journeyman/flow-editor` still exports `McpCatalogEntry` (Task 3 Step 3 must not have removed the type export).

- [ ] **Step 4: (Optional, if the app is running) Manually confirm the picker**

Open the flow editor, select a custom-AI step node, and open the MCP picker. Confirm it lists every catalog entry (including `resend` and `smtp`) grouped by category — now sourced from `GET /api/mcp-catalog`. Confirm the "Add MCP from catalog" modal still works. (Manual step; not required for the typecheck gate.)

---

## Notes

- **No commits** are performed by this plan, per request. Changes are left in the working tree on `master` for review.
- This is a pure refactor: no runtime behavior changes except that the canvas catalog is now fetched (briefly empty before the fetch resolves, or if the API errors — consistent with the existing `AddFromCatalogModal` behavior).
- Backend data, the `GET /api/mcp-catalog` response shape, and MCP resolution/runtime spawning are all unchanged.
