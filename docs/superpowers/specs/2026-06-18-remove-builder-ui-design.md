# Remove the Builder UI & Page (keep backend live)

**Date:** 2026-06-18
**Status:** Approved — ready for implementation planning

## Summary

Remove the entire conversational **builder frontend** from `@journeyman/web`. We
are not using the AI-chat flow builder right now, but the backend is solid and
worth keeping for future reuse. The backend — the `@journeyman/builder` package,
the `api-server` builder routes, the `core` types/registry, and the database
migration — stays **fully intact and registered/live**, ready to re-attach a UI
later with no re-wiring.

This is a frontend-only removal: ~12 files deleted from the web package and 2
small edits to wiring (router + sidebar nav).

## Background

There are two distinct "builder"-named surfaces in the codebase, and only one is
in scope:

- **In scope — the conversational AI builder.** A chat-driven flow builder: the
  user describes intent, an agent assembles a `BuildPlan`, and the plan is
  applied to create a workflow. Frontend lives under `packages/web/src/routes/`
  and `packages/web/src/api/builder.ts`; backend lives in `packages/builder/`
  plus two `api-server` route files.
- **Out of scope — incidental "builder" names.** `flow-editor`'s
  `ConditionBuilder`, `AcceptIfBuilder`, `RangeSetBuilder` (CodeMirror), and the
  `sandbox` "build inputs" code share the word "builder" but are unrelated.
  Leave them untouched.

## Goals

- Remove all builder UI from `@journeyman/web` (page, sidebar entry, route,
  supporting modules, and their tests).
- Keep the backend exactly as-is — package code **and** live route registrations
  — so the feature can be re-enabled later by adding a UI only.
- Leave the codebase type-checking, import-boundary-clean, and test-green after
  removal.

## Non-Goals

- No changes to `packages/builder/` (the backend package).
- No changes to the `api-server` builder route files or their registration in
  `server.ts` — the HTTP endpoints stay live and reachable.
- No changes to `core` builder types / `builder-availability` registry.
- No database migration, table drop, or data cleanup — `jm_builder_sessions`
  stays.
- No touching the unrelated `*Builder` components listed above.

## Design

### Decision: backend stays live

The backend remains fully wired and registered. Rationale (chosen by the user):
zero re-wiring when a UI is re-added later. The trade-off — builder HTTP
endpoints remain reachable with no UI driving them — is accepted. The endpoints
are auth-scoped (`/api/orgs/:orgId/users/me/builder/...`) like the rest of the
API, so this is unused surface, not unguarded surface.

### Files to delete

All under `packages/web/src/`. Each was confirmed to have no references outside
the builder frontend itself:

| File | Notes |
|---|---|
| `routes/BuilderPage.tsx` | The page component; only referenced by `App.tsx`. |
| `routes/SessionsSidebar.tsx` | Used only by `BuilderPage`. |
| `routes/StepCard.tsx` | Used only by `BuilderPage`. |
| `routes/builder-layout.ts` | Chat-width clamp helper; used only by `BuilderPage`. |
| `routes/builder-layout.test.ts` | Test for the above. |
| `routes/builder-state.ts` | Chat SSE reducer; used only by `BuilderPage`. |
| `routes/builder-state.test.ts` | Test for the above. |
| `routes/plan-edits.ts` | `BuildPlan` edit helpers; used only by `BuilderPage` + `StepCard`. |
| `routes/plan-edits.test.ts` | Test for the above. |
| `routes/sessions-view.ts` | Session label/badge/order helpers; used only by `SessionsSidebar`. |
| `routes/sessions-view.test.ts` | Test for the above. |
| `api/builder.ts` | Builder API client; used only by builder routes. |

### Files to edit

| File | Change |
|---|---|
| `packages/web/src/App.tsx` | Remove the `BuilderPage` import and the `<Route path="/builder" element={<BuilderPage />} />` route. |
| `packages/web/src/components/Sidebar.tsx` | Remove the `{ to: "/builder", icon: "🛠", label: "Builder" }` entry from `NAV_ITEMS`. |

### Explicitly NOT touched (the "solid backend")

- `packages/builder/` — entire package.
- `packages/api-server/src/routes/builder-apply.ts`, `builder-chat.ts`.
- `packages/api-server/src/server.ts` — the `registerBuilderRoutes`,
  `registerBuilderApplyRoute`, `registerBuilderChatRoute` calls stay.
- `packages/core/src/types/builder.types.ts`,
  `packages/core/src/registries/builder-availability.ts`.
- `packages/migrations/src/sql/043_builder_sessions.sql` and the
  `jm_builder_sessions` table.

## Error Handling / Edge Cases

- **Stale `/builder` URL.** After removal the SPA router has no `/builder` route.
  Navigating there directly renders nothing matched. This is acceptable; the
  entry is gone from the nav so it is not reachable through the UI. (No catch-all
  redirect exists today for other removed paths, so we add none here — matching
  existing behavior.)
- **Dangling imports.** Risk is a leftover import of a deleted module. Mitigated
  by the cross-reference check already performed (no external consumers) and by
  the typecheck gate below.

## Testing / Verification

- `npm run check` — typecheck + import-boundary check across the monorepo;
  catches any dangling import of a deleted module.
- `npm test` for `@journeyman/web` — confirms the remaining suite is green and
  that removing the four builder test files leaves no broken references.
- Manual sanity: the web app builds, the sidebar no longer shows "Builder", and
  the backend builder routes still register on `api-server` startup (unchanged).

## Net Effect

- 12 files deleted from `@journeyman/web`, 2 small wiring edits.
- Backend untouched; builder HTTP endpoints remain live but UI-less.
- Re-enabling later = build a new UI against the existing `api/builder` contract;
  no backend work required.
