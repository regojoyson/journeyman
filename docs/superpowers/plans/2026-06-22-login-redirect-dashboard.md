# Login Redirect → Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make login land on the per-workspace dashboard, except after an involuntary logout (session-expiry / idle-timeout), which returns the user to the page they were on.

**Architecture:** Frontend-only (`@journeyman/web`). The redirect *decision* lives in a new pure helper module (`auth/post-login-redirect.ts`) so it can be unit-tested without a DOM. `AuthGate` captures the current URL when the `session-expired` event fires (into an in-memory ref), and on the next successful login navigates either to the captured path or to `/` (which `HomeRedirect` resolves to the dashboard). `HomeRedirect`'s default landing changes from workflows → dashboard.

**Tech Stack:** React, react-router-dom (`useNavigate`), Vitest (node environment, `renderToStaticMarkup` — **no jsdom/testing-library**, so behavior is tested through pure functions).

**Spec:** [docs/superpowers/specs/2026-06-22-login-redirect-dashboard-design.md](../specs/2026-06-22-login-redirect-dashboard-design.md)

---

## Execution constraints (from the requester)

- **Master is read-only.** Do all work in an isolated git worktree / feature branch — never edit on `master`. Use the `superpowers:using-git-worktrees` skill before starting.
- **No commits.** Implement the changes but do **not** `git add`/`git commit`/`push`. Leave changes in the working tree for review. (The TDD steps below therefore omit commits.)
- **Typecheck once, at the end** — not per task. Tests (Vitest) still run per task as part of TDD.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/web/src/auth/post-login-redirect.ts` | Pure decision helpers: where to land after login, what to capture on involuntary logout, the workspace home path. No React, no DOM. | **Create** |
| `packages/web/src/auth/post-login-redirect.test.ts` | Unit tests for the three helpers. | **Create** |
| `packages/web/src/AuthGate.tsx` | Wire the helpers: capture URL on `session-expired`, navigate after login. | **Modify** |
| `packages/web/src/App.tsx` | `HomeRedirect` default landing → dashboard via the helper. | **Modify** |

---

## Task 1: Pure redirect-decision helpers (TDD)

**Files:**
- Create: `packages/web/src/auth/post-login-redirect.ts`
- Test: `packages/web/src/auth/post-login-redirect.test.ts`

These three functions encode the entire decision. `AuthGate` and `HomeRedirect` will call them in Tasks 2–3.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/auth/post-login-redirect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  workspaceHomePath,
  captureRestorePath,
  nextPathAfterLogin,
} from "./post-login-redirect.ts";

describe("workspaceHomePath", () => {
  it("points at the per-workspace dashboard", () => {
    expect(workspaceHomePath("w1")).toBe("/workspaces/w1/dashboard");
  });
});

describe("captureRestorePath", () => {
  it("returns the full path+search for a real page", () => {
    expect(captureRestorePath("/workspaces/w1/workflow-instances/123", "")).toBe(
      "/workspaces/w1/workflow-instances/123",
    );
  });
  it("preserves the query string", () => {
    expect(captureRestorePath("/workspaces/w1/workflows", "?tab=archived")).toBe(
      "/workspaces/w1/workflows?tab=archived",
    );
  });
  it("returns null for the app root (nothing meaningful to restore)", () => {
    expect(captureRestorePath("/", "")).toBeNull();
    expect(captureRestorePath("/", "?x=1")).toBeNull();
  });
});

describe("nextPathAfterLogin", () => {
  it("restores the captured path when present (involuntary logout)", () => {
    expect(nextPathAfterLogin("/workspaces/w1/workflow-instances/123")).toBe(
      "/workspaces/w1/workflow-instances/123",
    );
  });
  it("returns '/' when nothing was captured (fresh login / manual logout)", () => {
    expect(nextPathAfterLogin(null)).toBe("/");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/web && npx vitest run src/auth/post-login-redirect.test.ts`
Expected: FAIL — `Failed to resolve import "./post-login-redirect.ts"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `packages/web/src/auth/post-login-redirect.ts`:

```ts
// packages/web/src/auth/post-login-redirect.ts
//
// Pure decision helpers for where to send a user after login.
// Kept React-/DOM-free so they can be unit-tested in the node test environment.

/**
 * Per-workspace landing page. Used for fresh logins, logins after a manual
 * logout, and as the fallback when there is no page to restore.
 */
export function workspaceHomePath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/dashboard`;
}

/**
 * The path to remember when an *involuntary* logout (session-expiry or
 * idle-timeout) happens, so login can return the user there.
 * Returns null for the app root ("/"), which has no meaningful page to restore.
 */
export function captureRestorePath(pathname: string, search: string): string | null {
  if (pathname === "/") return null;
  return pathname + search;
}

/**
 * Where to navigate after a successful login.
 * - restorePath set (involuntary logout)  → that exact path
 * - null (fresh login or manual logout)    → "/", which HomeRedirect resolves
 *                                            to the workspace dashboard
 */
export function nextPathAfterLogin(restorePath: string | null): string {
  return restorePath ?? "/";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/web && npx vitest run src/auth/post-login-redirect.test.ts`
Expected: PASS — 6 tests passing.

---

## Task 2: Capture-on-expiry + redirect-on-login in `AuthGate`

**Files:**
- Modify: `packages/web/src/AuthGate.tsx`

`AuthGate` lives inside `BrowserRouter` (see [main.tsx](../../../packages/web/src/main.tsx)), so it can call `useNavigate()`. The current URL is read from `window.location` at event time — **not** from `useLocation()` — because the `manager.subscribe` callback is created once inside a `[manager]`-deps effect and would otherwise close over a stale location.

There is no isolated unit test for this wiring (no DOM test environment in `packages/web`); correctness of the *decision* is covered by Task 1's tests, and the wiring is verified manually in Task 4.

- [ ] **Step 1: Add the imports**

In `packages/web/src/AuthGate.tsx`, add `useNavigate` to the react-router import and import the helpers. The file currently imports React hooks on line 2 (`import { useEffect, useMemo, useRef, useState } from "react";`) and has no react-router import yet. Add a new import line near the other imports (after line 11):

```ts
import { useNavigate } from "react-router-dom";
import { captureRestorePath, nextPathAfterLogin } from "./auth/post-login-redirect.ts";
```

- [ ] **Step 2: Add the navigate handle and restore ref**

Inside `AuthGate`, just after the existing `const manager = managerRef.current;` line (currently line 24), add:

```ts
  const navigate = useNavigate();
  const restorePathRef = useRef<string | null>(null);
```

- [ ] **Step 3: Capture the current URL when the session expires**

In the `manager.subscribe` callback (currently lines 29–34), replace the `session-expired` branch so it captures the URL before showing the expired modal. Change:

```ts
      else if (e.type === "session-expired") setExpired(true);
```

to:

```ts
      else if (e.type === "session-expired") {
        // Involuntary logout — remember where the user was so login can return them.
        restorePathRef.current = captureRestorePath(
          window.location.pathname,
          window.location.search,
        );
        setExpired(true);
      }
```

(Manual logout goes through `handleLogout` and emits no `session-expired` event, so `restorePathRef` stays null for it — that is what makes manual logout fall through to the dashboard.)

- [ ] **Step 4: Navigate after a successful login**

Replace the existing `handleLogin` (currently lines 77–80):

```ts
  async function handleLogin(username: string, password: string): Promise<void> {
    await manager.login(username, password);
    setExpired(false);
  }
```

with:

```ts
  async function handleLogin(username: string, password: string): Promise<void> {
    await manager.login(username, password);
    const restore = restorePathRef.current;
    restorePathRef.current = null;
    setExpired(false);
    // restore set → involuntary-logout return; otherwise "/" → HomeRedirect → dashboard.
    navigate(nextPathAfterLogin(restore), { replace: true });
  }
```

- [ ] **Step 5: Run the web test suite to confirm nothing regressed**

Run: `cd packages/web && npx vitest run`
Expected: PASS — existing suites green, plus Task 1's `post-login-redirect.test.ts`.

---

## Task 3: Default landing → dashboard in `HomeRedirect`

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Import the helper**

In `packages/web/src/App.tsx`, add after the existing context imports (after line 34, `import { useWorkspace } from "./WorkspaceContext.tsx";`):

```ts
import { workspaceHomePath } from "./auth/post-login-redirect.ts";
```

- [ ] **Step 2: Change the redirect target**

In `HomeRedirect` (currently lines 36–47), replace the workflows redirect. Change:

```ts
  if (activeWorkspaceId) {
    return <Navigate to={`/workspaces/${activeWorkspaceId}/workflows`} replace />;
  }
```

to:

```ts
  if (activeWorkspaceId) {
    return <Navigate to={workspaceHomePath(activeWorkspaceId)} replace />;
  }
```

- [ ] **Step 3: Run the web test suite**

Run: `cd packages/web && npx vitest run`
Expected: PASS — all suites green.

---

## Task 4: Manual verification (optional, best-effort)

**Note:** `packages/web` has no DOM test environment, so login navigation is verified by hand. Per the project memory "Preview serves main repo not worktree", the Claude_Preview tool serves the main repo root, not a worktree — so if you implemented in a worktree, run a local dev server from the worktree instead of relying on preview.

- [ ] **Step 1: Run the app from the worktree**

Run: `npm run start:web` (and the API/infra it needs, if not already up).

- [ ] **Step 2: Verify the four scenarios**

  1. **Fresh login** (open the app unauthenticated, log in) → lands on `/workspaces/:wsId/dashboard`.
  2. **Manual logout then login** → lands on the dashboard.
  3. **Involuntary logout**: navigate to a deep page (e.g. a workflow-instance detail), trigger session-expiry (let the access+refresh fail, or shorten the idle timeout), then log in → returns to that deep page.
  4. **Involuntary logout at `/`** → falls back to the dashboard.

---

## Task 5: Typecheck (end only)

- [ ] **Step 1: Typecheck the workspace**

Run (from repo root): `npm run typecheck`
Expected: PASS — no type errors. If `npm run typecheck` is too broad, the equivalent for web is `npx tsc -p packages/web --noEmit` (use whichever the repo's `typecheck` script invokes).

- [ ] **Step 2: Confirm no commits were made**

Run: `git status`
Expected: the four files (2 created, 2 modified) appear as un-committed working-tree changes. Leave them for review — **do not commit**.

---

## Self-review notes

- **Spec coverage:** Default → dashboard (Task 3 + Task 2's `nextPathAfterLogin(null) → "/"`); involuntary-logout restore (Task 2 capture + restore); manual logout → dashboard (no capture, Task 2); fallback for root/unrestorable → dashboard (`captureRestorePath` returns null for `/`, Task 1). All four spec rows covered.
- **Type consistency:** Helper names are identical across tasks — `workspaceHomePath`, `captureRestorePath`, `nextPathAfterLogin` — defined in Task 1 and consumed verbatim in Tasks 2–3.
- **No persistence:** `restorePathRef` is an in-memory `useRef`; a reload/new tab during the expired state resets it → fresh login → dashboard, matching the chosen fallback.
