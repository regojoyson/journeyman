# Remove the Builder UI & Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the conversational builder frontend from `@journeyman/web` while leaving the backend (`@journeyman/builder` package, `api-server` builder routes, core types, DB migration) fully intact and live.

**Architecture:** Frontend-only removal. Delete the 12 builder-only files in `packages/web/src/`, then strip the two wiring references (router route + sidebar nav item). The backend is untouched, so its HTTP endpoints stay registered and reachable. Verify with the monorepo typecheck/import-boundary gate and the web test suite.

**Tech Stack:** React + react-router-dom, Vite, Vitest, TypeScript, npm workspaces.

**Branch:** Work directly on `master` (per user instruction). Commit after each task.

---

### Task 1: Unwire the builder route and nav entry

This task removes the two references to builder UI first, so that after the files are deleted in Task 2 there are no dangling imports at any intermediate commit.

**Files:**
- Modify: `packages/web/src/App.tsx` (remove import line 4, route line 37)
- Modify: `packages/web/src/components/Sidebar.tsx` (remove `NAV_ITEMS` entry line 9)

- [ ] **Step 1: Remove the BuilderPage import in App.tsx**

Delete this line from `packages/web/src/App.tsx`:

```tsx
import { BuilderPage } from "./routes/BuilderPage.tsx";
```

- [ ] **Step 2: Remove the /builder route in App.tsx**

Delete this line from the `<Routes>` block in `packages/web/src/App.tsx`:

```tsx
        <Route path="/builder" element={<BuilderPage />} />
```

- [ ] **Step 3: Remove the Builder nav item in Sidebar.tsx**

In `packages/web/src/components/Sidebar.tsx`, delete this entry from the `NAV_ITEMS` array (line 9):

```tsx
  { to: "/builder",            icon: "🛠", label: "Builder"            },
```

The array should then read (first three entries):

```tsx
const NAV_ITEMS = [
  { to: "/workflows",          icon: "⚡", label: "Workflows"          },
  { to: "/workflow-instances", icon: "▶",  label: "Workflow Instances" },
  { to: "/me/secrets",  icon: "🔑", label: "My Secrets" },
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/Sidebar.tsx
git commit -m "refactor(web): unwire builder route and sidebar nav entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Delete the builder frontend files

All 12 files are builder-only — confirmed during brainstorming to have no consumers outside the builder frontend. `App.tsx` and `Sidebar.tsx` no longer reference them after Task 1.

**Files:**
- Delete: `packages/web/src/routes/BuilderPage.tsx`
- Delete: `packages/web/src/routes/SessionsSidebar.tsx`
- Delete: `packages/web/src/routes/StepCard.tsx`
- Delete: `packages/web/src/routes/builder-layout.ts`
- Delete: `packages/web/src/routes/builder-layout.test.ts`
- Delete: `packages/web/src/routes/builder-state.ts`
- Delete: `packages/web/src/routes/builder-state.test.ts`
- Delete: `packages/web/src/routes/plan-edits.ts`
- Delete: `packages/web/src/routes/plan-edits.test.ts`
- Delete: `packages/web/src/routes/sessions-view.ts`
- Delete: `packages/web/src/routes/sessions-view.test.ts`
- Delete: `packages/web/src/api/builder.ts`

- [ ] **Step 1: Delete all 12 files**

```bash
git rm \
  packages/web/src/routes/BuilderPage.tsx \
  packages/web/src/routes/SessionsSidebar.tsx \
  packages/web/src/routes/StepCard.tsx \
  packages/web/src/routes/builder-layout.ts \
  packages/web/src/routes/builder-layout.test.ts \
  packages/web/src/routes/builder-state.ts \
  packages/web/src/routes/builder-state.test.ts \
  packages/web/src/routes/plan-edits.ts \
  packages/web/src/routes/plan-edits.test.ts \
  packages/web/src/routes/sessions-view.ts \
  packages/web/src/routes/sessions-view.test.ts \
  packages/web/src/api/builder.ts
```

- [ ] **Step 2: Verify no dangling references remain in the web package**

Run: `grep -rn -E "BuilderPage|SessionsSidebar|StepCard|builder-layout|builder-state|plan-edits|sessions-view|api/builder" packages/web/src`
Expected: no output (exit code 1). Any hit means a leftover import — remove it before continuing.

- [ ] **Step 3: Commit**

```bash
git add -A packages/web/src
git commit -m "refactor(web): remove builder UI page and supporting modules

Backend (@journeyman/builder, api-server routes, core types, migration)
left intact and registered for future reuse.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Verify the build is clean

No new code is added, so verification is the whole task: typecheck + import boundaries across the monorepo, and the web test suite (which no longer contains the four deleted builder test files).

**Files:** none (verification only)

- [ ] **Step 1: Run the monorepo check (typecheck + import boundaries)**

Run: `npm run check`
Expected: PASS. This catches any dangling import of a deleted module. If it fails referencing a builder file, remove the leftover import and re-run.

- [ ] **Step 2: Run the web test suite**

Run: `npm test --workspace @journeyman/web`
Expected: PASS. The suite runs `vitest run` and must be green with the four builder test files (`builder-layout`, `builder-state`, `plan-edits`, `sessions-view`) gone.

- [ ] **Step 3: Confirm the backend is untouched**

Run: `git status --porcelain packages/builder packages/api-server packages/core packages/migrations`
Expected: no output. None of the backend packages should have changed.

- [ ] **Step 4: Confirm backend route registration is still present**

Run: `grep -n "registerBuilderRoutes\|registerBuilderApplyRoute\|registerBuilderChatRoute" packages/api-server/src/server.ts`
Expected: the three registration calls still present (lines ~46, 71, 72). The builder HTTP endpoints remain live.

---

## Notes

- **Stale `/builder` URL:** After removal the SPA router has no `/builder` route and the nav entry is gone. Navigating to `/builder` directly matches nothing — acceptable, matches existing behavior for other absent paths (no catch-all redirect is added).
- **Backend deliberately preserved:** `packages/builder/`, `packages/api-server/src/routes/builder-apply.ts`, `builder-chat.ts`, the `server.ts` registrations, `core` builder types / `builder-availability` registry, and migration `043_builder_sessions.sql` (table `jm_builder_sessions`) are all out of scope and must stay.
- **Re-enabling later:** build a new UI against the existing `api/builder` HTTP contract; no backend work required.
