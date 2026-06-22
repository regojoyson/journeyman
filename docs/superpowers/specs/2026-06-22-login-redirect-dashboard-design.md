# Login redirect → Dashboard, with last-page restore on involuntary logout

**Date:** 2026-06-22
**Package:** `@journeyman/web` (frontend only — no backend, API, or storage changes)

## Problem

After logging in, users land on the workflows page (`/workspaces/:wsId/workflows`). We
want a fresh login to land on the **dashboard** instead. The one exception: if the user
was **involuntarily logged out** (session-expiry or idle-timeout) mid-work, logging back
in should return them to the page they were on.

## Behavior

| Scenario | Lands on |
|---|---|
| Fresh login (app was never authenticated this browser session) | `/workspaces/:wsId/dashboard` |
| Login after clicking the **Logout** button (manual logout) | `/workspaces/:wsId/dashboard` |
| Login after **session-expiry / idle-timeout** (involuntary logout) | the page they were on when kicked out |
| Restore target invalid (involuntary logout at app root, reloaded tab, or unknown route) | `/workspaces/:wsId/dashboard` (fallback) |

"Dashboard" means the per-workspace dashboard route `/workspaces/:wsId/dashboard`
([App.tsx](../../../packages/web/src/App.tsx) line 58).

## Background — current architecture

The relevant flow already contains the building blocks:

- **`BrowserRouter` wraps `AuthGate`** ([main.tsx](../../../packages/web/src/main.tsx)),
  so `AuthGate` is inside Router context and can use `useLocation()` / `useNavigate()`.
- **`LoginPage` is rendered conditionally _over_ the current URL** — it is not a route
  ([AuthGate.tsx](../../../packages/web/src/AuthGate.tsx) lines 96–103). When a session
  expires, the browser URL (e.g. `/workspaces/X/workflow-instances/123`) is preserved
  underneath the login form. `SessionManager` never resets the URL on logout or expiry.
- **`AuthGate` already distinguishes involuntary from manual logout**: the
  `session-expired` event sets the `expired` flag
  ([AuthGate.tsx](../../../packages/web/src/AuthGate.tsx) line 33); manual logout goes
  through `handleLogout` and emits no such event.
- **Fresh login at `/` resolves through `HomeRedirect`**, which is currently hardcoded to
  `/workspaces/:wsId/workflows` ([App.tsx](../../../packages/web/src/App.tsx) line 40).

## Design

All changes live in `packages/web`. Approach: capture-on-expiry in `AuthGate` + change
the default landing in `HomeRedirect`. No new persistence and no new global state.

### 1. `AuthGate.tsx` — capture + restore

- Add `useLocation()` and `useNavigate()` (gate is under `BrowserRouter`).
- Add a `restorePathRef = useRef<string | null>(null)`.
- In the existing `manager.subscribe` handler, when the event is `session-expired`,
  capture the current location:
  ```ts
  const path = location.pathname + location.search;
  restorePathRef.current = path === "/" ? null : path;
  ```
  Capturing only on `session-expired` (not on manual logout) is what restricts restore to
  involuntary logout.
- In `handleLogin`, after `await manager.login(...)` succeeds:
  ```ts
  const restore = restorePathRef.current;
  restorePathRef.current = null;
  setExpired(false);
  if (restore) navigate(restore, { replace: true });
  else navigate("/", { replace: true }); // → HomeRedirect → dashboard
  ```
  Navigating to `/` on a normal login makes "fresh login → dashboard" airtight even when
  the login form was shown over a deep bookmarked URL.

### 2. `App.tsx` → `HomeRedirect` — default landing

Change the redirect target from `workflows` to `dashboard`:
```ts
return <Navigate to={`/workspaces/${activeWorkspaceId}/dashboard`} replace />;
```
This is what a fresh login resolves to, and the fallback for an unrestorable session.

### Data flow

```
session-expired event ──► capture location into restorePathRef (in-memory, null if "/")
        │
   LoginPage shown over the preserved URL
        │
   handleLogin success
        ├── restorePathRef set?  ── navigate(captured, replace) ──► last page
        └── not set (fresh / manual logout) ── navigate("/", replace) ──► HomeRedirect ──► dashboard
```

## Key decisions & edge cases

- **In-memory ref, not persisted** — a page reload or new tab during the expired state is
  intentionally treated as a fresh login (→ dashboard), matching the chosen fallback. A
  persisted `returnTo` (sessionStorage/localStorage) was rejected: it would wrongly
  resurrect a stale deep link after a tab-close/next-day login, and adds write-on-every-
  route overhead.
- **No `/login?returnTo=` route** — the app deliberately renders `LoginPage` as a
  conditional overlay, so the URL is already preserved for free. Introducing a login route
  with a `returnTo` param would restructure the auth-gate/routing model for no functional
  gain.
- **Restore validity** — react-router renders `/workspaces/:wsId/...` paths through the
  route table. We guard only the `/` case (captured as `null`); we do not build a
  route-existence registry. A stale-but-matched path renders its page; the app's existing
  per-page workspace/permission handling applies as it does for any direct navigation.
- **Manual logout never captures**, so it always falls through to the dashboard — the
  required semantics.

## Testing

`packages/web` already has component-test infrastructure.

- **`AuthGate`**
  - Simulate `session-expired` while at `/workspaces/X/workflow-instances/123`, then a
    successful login → assert `navigate` called with that path.
  - Simulate `session-expired` while at `/`, then login → assert `navigate("/")`
    (→ dashboard fallback).
  - Fresh login (no prior expiry) → assert `navigate("/")`.
  - Manual `handleLogout` then login → assert `navigate("/")` (dashboard, no restore).
- **`HomeRedirect`**
  - `activeWorkspaceId` set → renders `<Navigate>` to `/workspaces/:wsId/dashboard`.

## Out of scope

- Backend / token / cookie behavior — unchanged.
- The default-workspace selection logic in `WorkspaceProvider` — unchanged.
- Restoring scroll position or in-page state on the restored page.
