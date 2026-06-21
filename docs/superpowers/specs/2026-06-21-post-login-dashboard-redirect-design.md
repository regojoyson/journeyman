# Post-Login Dashboard Redirect — Design

**Date:** 2026-06-21
**Status:** Approved (design)

## Problem

After logging in, users land on the Workflows page (`/workspaces/:wsId/workflows`). They should land on the Dashboard page (`/workspaces/:wsId/dashboard`) instead.

## Current Behavior

The post-login destination is not set by an explicit `navigate()` call. After a successful login, `AuthGate` renders `<App />` with the browser still at `/`. The `/` route renders the `HomeRedirect` component, which redirects based on the active workspace:

`packages/web/src/App.tsx` (lines 34–45):

```tsx
function HomeRedirect() {
  const { loading, activeWorkspaceId } = useWorkspace();
  if (loading) return null;
  if (activeWorkspaceId) {
    return <Navigate to={`/workspaces/${activeWorkspaceId}/workflows`} replace />;
  }
  return (
    <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>
      No workspaces available.
    </div>
  );
}
```

The `/workspaces/:wsId/dashboard` route and its `DashboardPage` component already exist (`App.tsx:56`) and carry no extra permission gating beyond being authenticated — the same access level as the workflows route.

## Change

Change the redirect target in `HomeRedirect` from `workflows` to `dashboard`:

```tsx
return <Navigate to={`/workspaces/${activeWorkspaceId}/dashboard`} replace />;
```

This is the entire change — one line in `packages/web/src/App.tsx`.

## Scope & Consequences

- **Decision:** Home (`/`) resolves to the dashboard for **all** navigations, not just the first landing after login. This is the simplest implementation and gives consistent "home = dashboard" behavior.
- **Login landing:** Users land on the dashboard after login. ✅ (the goal)
- **Other `/` redirects:** The non-admin fallbacks for `/orgs/...` routes (`App.tsx:76–88`) redirect to `/`, so they now resolve to the dashboard too. This is acceptable and consistent.
- **Unchanged:** The "No workspaces available" fallback remains. Direct links to `/workspaces/:wsId/workflows` continue to work. Sidebar/navigation is untouched.

## Testing / Verification

- Manual: log in and confirm the browser lands on `/workspaces/:wsId/dashboard` and the dashboard renders.
- Run `npm run check` (typecheck + import boundaries) — though a string-literal route change is type-safe, this confirms no regression.
- Verify via the browser preview workflow (reload `/`, confirm redirect lands on the dashboard).

## Out of Scope

- No changes to the sidebar/nav default highlight.
- No "first login only" tracking — explicitly rejected in favor of consistent home behavior.
- No changes to workspace-switch behavior or the dashboard page itself.
