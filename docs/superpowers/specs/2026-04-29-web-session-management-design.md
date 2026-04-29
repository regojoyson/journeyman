# Web Session Management — Design

**Date:** 2026-04-29
**Package:** `packages/web`
**Status:** Proposed

## Problem

The current `packages/web` auth flow checks `/api/auth/me` once on mount and never re-validates. Symptoms reported:

- The access token can be invalidated server-side and the SPA does not detect it — API calls fail silently or surface raw 401s to the user.
- Refresh tokens are not exercised by the client; sessions effectively die when the access token expires.
- There is no warning before logout — users lose unsaved work without notice.

## Goals

1. Detect access-token expiry and refresh proactively (no user-visible failure).
2. Recover from unexpected 401s by attempting refresh once, then retrying the failed request.
3. Show a warning modal before idle-driven logout, with a clear "stay signed in" affordance.
4. Keep the design **standards-aligned** so the cookie-session backend can later be swapped for an external OIDC/OAuth2 provider (Keycloak, Auth0, Okta) without rewriting the app.
5. Synchronize session state across browser tabs.

## Non-goals

- Implementing the OIDC backend itself.
- SSO discovery / dynamic client registration.
- Per-route ACL changes (covered by existing `flow-scopes` / `run-scopes` specs).

## Backend assumptions

- Access token stored in **HttpOnly cookie** (not readable from JS).
- `POST /api/auth/refresh` rotates the access token cookie and returns the new session payload.
- `/api/auth/me` and `/api/auth/refresh` both return a session payload that includes the access token's expiry as a unix-seconds `exp` claim (OIDC standard name).
- Idle timeout: 30 minutes (client-driven for UX; server may enforce its own).

## Standards alignment

The client uses OIDC/OAuth2 vocabulary internally so an OIDC `AuthProvider` can replace the cookie one without touching consumers.

| Concern | OIDC/OAuth2 standard | Internal cookie impl |
|---|---|---|
| Session claims | `sub`, `exp`, `iat`, `preferred_username`, `name` | `/api/auth/me` returns these names |
| Token refresh | `POST /token` with `grant_type=refresh_token` | `POST /api/auth/refresh` |
| Logout | `end_session_endpoint` + `post_logout_redirect_uri` | `POST /api/auth/logout` |
| Silent refresh trigger | `exp − leeway` | same |
| Back-channel logout | OIDC back-channel logout token | `BroadcastChannel('auth')` |
| Login | Authorize endpoint + PKCE | `POST /api/auth/login` |

## Architecture

### `AuthProvider` interface (pluggable)

```ts
// src/auth/AuthProvider.ts
export interface Session {
  sub: string;
  preferred_username: string;
  name: string | null;
  exp: number;                     // unix seconds
  org: { id: string; slug?: string; name?: string } | null;
  role: string;
  isPlatformAdmin: boolean;
}

export interface AuthProvider {
  getSession(): Promise<Session | null>;
  refresh(): Promise<Session>;
  login(): Promise<void> | string;       // void = handled inline; string = redirect URL
  logout(): Promise<void> | string;      // void = inline; string = post-logout redirect URL
  onSessionChanged(cb: (s: Session | null) => void): () => void;
  readonly config: { refreshLeewaySeconds: number };
}
```

Today: `CookieAuthProvider` (calls `/api/auth/me`, `/refresh`, `/logout`).
Future: `OidcAuthProvider` (oidc-client-ts or equivalent) — same interface.

### `SessionManager`

A single React-tree-level singleton owning:

1. **Expiry tracking** — schedules `setTimeout` for `(exp − leeway) × 1000` ms; on fire, calls `provider.refresh()`.
2. **Idle tracking** — `mousemove`/`keydown`/`click`/`scroll`/`touchstart` listeners (passive, 1s-throttled). Resets `lastActivityAt`. A 1s ticker checks `idleMs`.
3. **Cross-tab sync** — `BroadcastChannel('auth')` for `session-refreshed`, `session-started`, `logout` events.

### API client (`api/client.ts`) integration

- Inject `authProvider` (or read from a module-level holder).
- On 401 response: enqueue concurrent failures behind a single in-flight `provider.refresh()` promise; retry the original request once on success.
- If refresh returns 401/403: clear session, dispatch `logout` event, surface session-failure modal.
- 5xx / network errors from `/refresh`: retry up to 2× with exponential backoff (1s, 3s) before treating as failure.

### React surface

- `<AuthGate>` continues to gate the app but delegates to `SessionManager` for ongoing checks.
- `AuthContext` exposes (in addition to today's fields):
  - `session: Session | null`
  - `secondsUntilExpiry: number`
  - `secondsUntilIdleLogout: number`
  - `refresh(): Promise<void>`
  - `extend(): Promise<void>` (called by warning modal "Stay signed in")
- Two new modals (rendered at `<AppShell>` level):
  - **`<IdleWarningModal>`** — 60s countdown when `idleMs ≥ 29 min`.
  - **`<SessionExpiredModal>`** — terminal state when refresh fails.

## Refresh flow

### Proactive (silent)

1. After login or `getSession()`, store `exp`.
2. Schedule `refreshTimer = setTimeout(provider.refresh, (exp − now − 60s) × 1000)`.
3. On success: store new `exp`, broadcast `session-refreshed`, reschedule.
4. On failure: see "Failure handling" below.

### Reactive (401 interceptor)

1. Request returns 401.
2. If a refresh is already in-flight → await its promise; otherwise start one.
3. On refresh success → retry original request once. If it 401s again, treat as session-failure.
4. On refresh failure → broadcast `logout`, show `<SessionExpiredModal>`.

### Concurrency

- Single shared `inFlightRefresh: Promise<Session> | null` on the manager.
- All callers (proactive timer, 401 interceptor, manual `refresh()`) await the same promise.

## Idle tracking

| Threshold | Action |
|---|---|
| `idleMs ≥ 29 min` | Show `<IdleWarningModal>` with 60s countdown |
| `idleMs ≥ 30 min` | Call `provider.logout()`, broadcast `logout`, route to login |

- Activity listeners are `{ passive: true }`, throttled to 1 event per second.
- **While the warning modal is open, activity does NOT auto-dismiss.** User must click "Stay signed in" — prevents accidental mouse-jiggle from extending sessions.
- "Stay signed in" → `provider.refresh()` → resets `lastActivityAt`, closes modal.
- "Sign out now" → `provider.logout()` → routes to login.

## Cross-tab sync

`BroadcastChannel('auth')` events:

| Event | Payload | Effect on receiving tabs |
|---|---|---|
| `session-started` | `{ session }` | Hydrate state, schedule refresh, no `/me` call |
| `session-refreshed` | `{ exp }` | Update `exp`, reschedule refresh timer |
| `logout` | `{}` | Clear state, cancel timers, route to login |

Future OIDC back-channel logout: same event names dispatched from a back-channel listener.

## Visibility handling

- On `visibilitychange → visible`: if `now ≥ exp − leeway`, trigger refresh immediately (don't wait for the next API call).
- Backgrounded tab `setTimeout` is unreliable; visibility check is the catch-up path.

## Edge cases

| Case | Behavior |
|---|---|
| 401 during logout | Swallow — no "session expired" modal on intentional sign-out |
| Concurrent 401s | All await single shared refresh promise |
| `/refresh` 5xx or network error | Retry 2× (1s, 3s backoff), then session-failure |
| `/refresh` 401/403 | Immediate session-failure (no retry) |
| Login redirect preservation | Save current pathname pre-login; restore post-login (OIDC `state`-like) |
| Activity perf | Passive listeners + 1s throttle |
| Clock skew | Trust server `exp`; never decode tokens client-side (HttpOnly anyway) |

## File layout

```
packages/web/src/
├── auth/
│   ├── AuthProvider.ts             ← interface + Session type
│   ├── CookieAuthProvider.ts       ← today's implementation
│   ├── SessionManager.ts           ← timers + broadcast + interceptor wiring
│   └── modals/
│       ├── IdleWarningModal.tsx
│       └── SessionExpiredModal.tsx
├── AuthContext.tsx                 ← extended with session/exp/extend/refresh
├── AuthGate.tsx                    ← delegates ongoing checks to SessionManager
└── api/client.ts                   ← 401 interceptor calls authProvider.refresh
```

## Backend changes required

- `/api/auth/me` and `/api/auth/refresh` must return `exp` (unix seconds).
- `/api/auth/refresh` must rotate the access token cookie and return the new session payload.
- Recommended (not blocking): rename payload claims to OIDC standard (`sub`, `preferred_username`, `name`). If not feasible now, `CookieAuthProvider` adapts internally.

## Out of scope

- Server-side session/refresh-token storage strategy.
- OIDC IdP selection.
- Forced re-auth for sensitive operations (step-up auth) — separate spec.

## Open questions

- Should the warning modal use 60s countdown or surface remaining session time directly? (Default: 60s.)
- Does the backend already return `exp`, or does an adapter need to translate `expiresAt` → `exp`? (Confirmed: backend can return `exp`.)
