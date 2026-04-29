# Web Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add proactive token refresh, 401 retry, idle warning modal, multi-tab sync, and a pluggable `AuthProvider` to `packages/web` so an OIDC backend can later drop in without app changes.

**Architecture:** Introduce `AuthProvider` interface (today: `CookieAuthProvider`). A `SessionManager` owns expiry timers, idle tracking, and `BroadcastChannel` cross-tab sync. The `api()` client gets a 401 interceptor that calls `provider.refresh()` once. Two modals (`IdleWarningModal`, `SessionExpiredModal`) handle UX.

**Tech Stack:** React 18, TypeScript, Vite, react-router-dom v7. No new runtime deps.

**Per user instruction:** No commits, no unit tests. Run `npm --workspace @journeyman/web run typecheck` once at the end.

**Spec:** [`docs/superpowers/specs/2026-04-29-web-session-management-design.md`](../specs/2026-04-29-web-session-management-design.md)

---

## File map

```
packages/web/src/
├── auth/
│   ├── AuthProvider.ts             ← NEW: interface + Session type
│   ├── CookieAuthProvider.ts       ← NEW: today's behavior, behind interface
│   ├── SessionManager.ts           ← NEW: timers + idle + broadcast + interceptor wiring
│   ├── broadcast.ts                ← NEW: BroadcastChannel helper
│   └── modals/
│       ├── IdleWarningModal.tsx    ← NEW
│       └── SessionExpiredModal.tsx ← NEW
├── AuthContext.tsx                 ← MODIFY: extend with session/exp/extend/refresh
├── AuthGate.tsx                    ← MODIFY: delegate to provider + manager
├── api/client.ts                   ← MODIFY: 401 interceptor
├── components/AppShell.tsx         ← MODIFY: render modals
└── App.tsx                         ← MODIFY: instantiate provider/manager
```

**Backend contract assumed:** `/api/auth/me`, `/api/auth/refresh`, `/api/auth/login`, `/api/auth/logout` all return JSON shaped:

```json
{
  "user": { "id": "...", "username": "...", "displayName": "..." | null, "isPlatformAdmin": false },
  "activeOrg": { "id": "...", "slug": "...", "name": "..." } | null,
  "role": "admin" | "member" | string,
  "isPlatformAdmin": false,
  "exp": 1730000000
}
```

If the backend currently returns `expiresAt` (ISO) instead of `exp` (unix sec), `CookieAuthProvider` adapts (Task 2).

---

## Task 1: Define `AuthProvider` interface and `Session` type

**Files:**
- Create: `packages/web/src/auth/AuthProvider.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/web/src/auth/AuthProvider.ts

export interface SessionUser {
  sub: string;
  preferred_username: string;
  name: string | null;
  isPlatformAdmin: boolean;
}

export interface SessionOrg {
  id: string;
  slug?: string;
  name?: string;
}

export interface Session {
  user: SessionUser;
  org: SessionOrg | null;
  role: string;
  exp: number; // unix seconds
}

export interface AuthProviderConfig {
  refreshLeewaySeconds: number; // refresh this many seconds before exp
  idleTimeoutSeconds: number;   // 30 * 60
  idleWarnBeforeSeconds: number; // 60
}

export interface AuthProvider {
  getSession(): Promise<Session | null>;
  refresh(): Promise<Session>;
  login(username: string, password: string): Promise<Session>;
  logout(): Promise<void>;
  readonly config: AuthProviderConfig;
}

export const DEFAULT_AUTH_CONFIG: AuthProviderConfig = {
  refreshLeewaySeconds: 60,
  idleTimeoutSeconds: 30 * 60,
  idleWarnBeforeSeconds: 60,
};
```

---

## Task 2: Implement `CookieAuthProvider`

**Files:**
- Create: `packages/web/src/auth/CookieAuthProvider.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/web/src/auth/CookieAuthProvider.ts
import {
  AuthProvider,
  AuthProviderConfig,
  DEFAULT_AUTH_CONFIG,
  Session,
} from "./AuthProvider";

interface RawMePayload {
  user?: { id: string; username: string; displayName: string | null; isPlatformAdmin?: boolean };
  activeOrg?: { id: string; slug?: string; name?: string } | null;
  role?: string;
  isPlatformAdmin?: boolean;
  exp?: number;       // preferred (unix sec)
  expiresAt?: string; // legacy ISO
}

function adapt(payload: RawMePayload): Session | null {
  if (!payload.user) return null;
  const exp =
    typeof payload.exp === "number"
      ? payload.exp
      : payload.expiresAt
        ? Math.floor(new Date(payload.expiresAt).getTime() / 1000)
        : 0;
  return {
    user: {
      sub: payload.user.id,
      preferred_username: payload.user.username,
      name: payload.user.displayName,
      isPlatformAdmin: payload.isPlatformAdmin ?? payload.user.isPlatformAdmin ?? false,
    },
    org: payload.activeOrg
      ? { id: payload.activeOrg.id, slug: payload.activeOrg.slug, name: payload.activeOrg.name }
      : null,
    role: payload.role ?? "",
    exp,
  };
}

export class CookieAuthProvider implements AuthProvider {
  readonly config: AuthProviderConfig;

  constructor(private readonly baseUrl: string = "", config: Partial<AuthProviderConfig> = {}) {
    this.config = { ...DEFAULT_AUTH_CONFIG, ...config };
  }

  async getSession(): Promise<Session | null> {
    const res = await fetch(`${this.baseUrl}/api/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    return adapt(await res.json() as RawMePayload);
  }

  async refresh(): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const err = new Error(`refresh failed: ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const session = adapt(await res.json() as RawMePayload);
    if (!session) throw new Error("refresh returned no session");
    return session;
  }

  async login(username: string, password: string): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = new Error(`login failed: ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const session = adapt(await res.json() as RawMePayload);
    if (!session) throw new Error("login returned no session");
    return session;
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // swallow — client will clear state regardless
    }
  }
}
```

> **Note on `login`:** the existing `LoginPage` may post directly to `/api/auth/login`. Task 7 keeps that flow but routes the call through `provider.login()` so the manager can immediately seed `exp`.

---

## Task 3: BroadcastChannel helper

**Files:**
- Create: `packages/web/src/auth/broadcast.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/web/src/auth/broadcast.ts

export type AuthBroadcastEvent =
  | { type: "session-started"; exp: number }
  | { type: "session-refreshed"; exp: number }
  | { type: "logout" };

const CHANNEL_NAME = "auth";

export interface AuthBroadcaster {
  post(event: AuthBroadcastEvent): void;
  subscribe(cb: (event: AuthBroadcastEvent) => void): () => void;
  close(): void;
}

class BroadcastChannelImpl implements AuthBroadcaster {
  private channel: BroadcastChannel;
  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
  }
  post(event: AuthBroadcastEvent): void {
    this.channel.postMessage(event);
  }
  subscribe(cb: (event: AuthBroadcastEvent) => void): () => void {
    const handler = (e: MessageEvent<AuthBroadcastEvent>) => cb(e.data);
    this.channel.addEventListener("message", handler);
    return () => this.channel.removeEventListener("message", handler);
  }
  close(): void {
    this.channel.close();
  }
}

class NoopBroadcaster implements AuthBroadcaster {
  post(): void {}
  subscribe(): () => void { return () => {}; }
  close(): void {}
}

export function createAuthBroadcaster(): AuthBroadcaster {
  if (typeof BroadcastChannel === "undefined") return new NoopBroadcaster();
  return new BroadcastChannelImpl();
}
```

---

## Task 4: SessionManager

**Files:**
- Create: `packages/web/src/auth/SessionManager.ts`

- [ ] **Step 1: Create the file**

```ts
// packages/web/src/auth/SessionManager.ts
import { AuthProvider, Session } from "./AuthProvider";
import { AuthBroadcaster, createAuthBroadcaster } from "./broadcast";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; session: Session };

export type SessionEvent =
  | { type: "state"; state: SessionState }
  | { type: "idle-warning"; secondsRemaining: number }
  | { type: "idle-warning-cleared" }
  | { type: "session-expired" };

const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
const ACTIVITY_THROTTLE_MS = 1000;
const TICK_MS = 1000;
const REFRESH_RETRY_DELAYS_MS = [1000, 3000];

export class SessionManager {
  private listeners = new Set<(e: SessionEvent) => void>();
  private state: SessionState = { status: "loading" };
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTicker: ReturnType<typeof setInterval> | null = null;
  private inFlightRefresh: Promise<Session> | null = null;
  private lastActivityAt = Date.now();
  private lastActivityFlushAt = 0;
  private warningOpen = false;
  private loggingOut = false;
  private broadcaster: AuthBroadcaster;
  private unsubBroadcast: (() => void) | null = null;
  private boundOnActivity = () => this.onActivity();
  private boundOnVisibility = () => this.onVisibility();

  constructor(private readonly provider: AuthProvider) {
    this.broadcaster = createAuthBroadcaster();
  }

  // ---- public API --------------------------------------------------------

  async start(): Promise<void> {
    this.attachDomListeners();
    this.unsubBroadcast = this.broadcaster.subscribe((e) => this.onBroadcast(e));
    const session = await this.provider.getSession();
    if (session) this.adoptSession(session, /*broadcast*/ false);
    else this.setState({ status: "anonymous" });
  }

  stop(): void {
    this.detachDomListeners();
    this.clearRefreshTimer();
    this.stopIdleTicker();
    if (this.unsubBroadcast) { this.unsubBroadcast(); this.unsubBroadcast = null; }
    this.broadcaster.close();
  }

  subscribe(cb: (e: SessionEvent) => void): () => void {
    this.listeners.add(cb);
    cb({ type: "state", state: this.state });
    return () => this.listeners.delete(cb);
  }

  getState(): SessionState { return this.state; }

  async login(username: string, password: string): Promise<void> {
    const session = await this.provider.login(username, password);
    this.adoptSession(session, /*broadcast*/ true, "session-started");
  }

  async logout(): Promise<void> {
    if (this.loggingOut) return;
    this.loggingOut = true;
    try {
      await this.provider.logout();
    } finally {
      this.broadcaster.post({ type: "logout" });
      this.handleLoggedOut();
      this.loggingOut = false;
    }
  }

  // Called by api() interceptor and the "Stay signed in" button.
  async refresh(): Promise<Session> {
    if (this.inFlightRefresh) return this.inFlightRefresh;
    this.inFlightRefresh = this.runRefresh().finally(() => { this.inFlightRefresh = null; });
    return this.inFlightRefresh;
  }

  // Called by IdleWarningModal "Stay signed in".
  async extend(): Promise<void> {
    this.lastActivityAt = Date.now();
    this.dismissWarning();
    await this.refresh();
  }

  // ---- internal ----------------------------------------------------------

  private async runRefresh(): Promise<Session> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= REFRESH_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const session = await this.provider.refresh();
        this.adoptSession(session, /*broadcast*/ true, "session-refreshed");
        return session;
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) break; // do not retry on auth failure
        const delay = REFRESH_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    this.handleSessionExpired();
    throw lastErr instanceof Error ? lastErr : new Error("refresh failed");
  }

  private adoptSession(
    session: Session,
    broadcast: boolean,
    broadcastType: "session-started" | "session-refreshed" = "session-refreshed",
  ): void {
    this.setState({ status: "authenticated", session });
    this.scheduleRefresh(session.exp);
    this.startIdleTicker();
    this.lastActivityAt = Date.now();
    if (broadcast) this.broadcaster.post({ type: broadcastType, exp: session.exp });
  }

  private scheduleRefresh(exp: number): void {
    this.clearRefreshTimer();
    const nowMs = Date.now();
    const fireAtMs = (exp - this.provider.config.refreshLeewaySeconds) * 1000;
    const delay = Math.max(0, fireAtMs - nowMs);
    this.refreshTimer = setTimeout(() => { void this.refresh(); }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
  }

  private startIdleTicker(): void {
    if (this.idleTicker) return;
    this.idleTicker = setInterval(() => this.tickIdle(), TICK_MS);
  }

  private stopIdleTicker(): void {
    if (this.idleTicker) { clearInterval(this.idleTicker); this.idleTicker = null; }
  }

  private tickIdle(): void {
    if (this.state.status !== "authenticated") return;
    const idleMs = Date.now() - this.lastActivityAt;
    const { idleTimeoutSeconds, idleWarnBeforeSeconds } = this.provider.config;
    const warnAtMs = (idleTimeoutSeconds - idleWarnBeforeSeconds) * 1000;
    const logoutAtMs = idleTimeoutSeconds * 1000;

    if (idleMs >= logoutAtMs) {
      void this.logout();
      return;
    }
    if (idleMs >= warnAtMs) {
      const secondsRemaining = Math.max(0, Math.ceil((logoutAtMs - idleMs) / 1000));
      this.warningOpen = true;
      this.emit({ type: "idle-warning", secondsRemaining });
    }
  }

  private dismissWarning(): void {
    if (!this.warningOpen) return;
    this.warningOpen = false;
    this.emit({ type: "idle-warning-cleared" });
  }

  private onActivity(): void {
    if (this.warningOpen) return; // do NOT auto-dismiss; require explicit click
    const now = Date.now();
    if (now - this.lastActivityFlushAt < ACTIVITY_THROTTLE_MS) return;
    this.lastActivityFlushAt = now;
    this.lastActivityAt = now;
  }

  private onVisibility(): void {
    if (document.visibilityState !== "visible") return;
    if (this.state.status !== "authenticated") return;
    const exp = this.state.session.exp;
    const leeway = this.provider.config.refreshLeewaySeconds;
    if (Date.now() >= (exp - leeway) * 1000) void this.refresh();
  }

  private onBroadcast(e: { type: string; exp?: number }): void {
    if (e.type === "logout") {
      this.handleLoggedOut();
      return;
    }
    if (e.type === "session-refreshed" && e.exp && this.state.status === "authenticated") {
      const next = { ...this.state.session, exp: e.exp };
      this.setState({ status: "authenticated", session: next });
      this.scheduleRefresh(e.exp);
      return;
    }
    if (e.type === "session-started" && e.exp) {
      // another tab logged in — re-fetch session in this tab
      void this.provider.getSession().then((s) => {
        if (s) this.adoptSession(s, /*broadcast*/ false);
      });
    }
  }

  private handleLoggedOut(): void {
    this.dismissWarning();
    this.clearRefreshTimer();
    this.stopIdleTicker();
    this.setState({ status: "anonymous" });
  }

  private handleSessionExpired(): void {
    this.dismissWarning();
    this.clearRefreshTimer();
    this.stopIdleTicker();
    this.setState({ status: "anonymous" });
    this.emit({ type: "session-expired" });
    this.broadcaster.post({ type: "logout" });
  }

  private attachDomListeners(): void {
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, this.boundOnActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", this.boundOnVisibility);
  }

  private detachDomListeners(): void {
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, this.boundOnActivity);
    }
    document.removeEventListener("visibilitychange", this.boundOnVisibility);
  }

  private setState(next: SessionState): void {
    this.state = next;
    this.emit({ type: "state", state: next });
  }

  private emit(event: SessionEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}
```

---

## Task 5: 401 interceptor in `api/client.ts`

**Files:**
- Modify: `packages/web/src/api/client.ts`

- [ ] **Step 1: Replace file contents**

```ts
// packages/web/src/api/client.ts
import type { SessionManager } from "../auth/SessionManager";

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

let sessionManager: SessionManager | null = null;
export function setApiSessionManager(m: SessionManager | null): void {
  sessionManager = m;
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await doFetch(path, init);

  if (res.status === 401 && sessionManager && !path.includes("/api/auth/")) {
    try {
      await sessionManager.refresh();
      res = await doFetch(path, init);
    } catch {
      // refresh failed — fall through and surface the 401
    }
  }

  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown = body;
    try { parsed = JSON.parse(body); } catch { /* leave as string */ }
    throw new ApiError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

export const conductorUiUrl = (import.meta.env.VITE_CONDUCTOR_UI_URL as string | undefined) ?? "";
```

---

## Task 6: Extend `AuthContext`

**Files:**
- Modify: `packages/web/src/AuthContext.tsx`

- [ ] **Step 1: Replace file contents**

```tsx
// packages/web/src/AuthContext.tsx
import { createContext, useContext } from "react";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
}

export interface AuthOrg {
  id: string;
  slug?: string;
  name?: string;
}

export interface AuthCtx {
  activeOrgId: string;
  role: "admin" | "member" | string;
  isPlatformAdmin: boolean;
  user: AuthUser | null;
  org: AuthOrg | null;
  exp: number;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  extend: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtx>({
  activeOrgId: "",
  role: "",
  isPlatformAdmin: false,
  user: null,
  org: null,
  exp: 0,
  logout: async () => {},
  refresh: async () => {},
  extend: async () => {},
});

export function useAuth(): AuthCtx {
  return useContext(AuthContext);
}
```

---

## Task 7: Rewire `AuthGate` to use provider + manager

**Files:**
- Modify: `packages/web/src/AuthGate.tsx`

> Keep the current bootstrap/setup/login/ready phases; replace the ad-hoc fetch with `SessionManager`.

- [ ] **Step 1: Replace file contents**

```tsx
// packages/web/src/AuthGate.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { SetupWizardPage } from "./routes/SetupWizardPage.tsx";
import { LoginPage } from "./routes/LoginPage.tsx";
import { AuthContext, type AuthOrg, type AuthUser } from "./AuthContext.tsx";
import { CookieAuthProvider } from "./auth/CookieAuthProvider.ts";
import { SessionManager, type SessionEvent, type SessionState } from "./auth/SessionManager.ts";
import { setApiSessionManager } from "./api/client.ts";
import { IdleWarningModal } from "./auth/modals/IdleWarningModal.tsx";
import { SessionExpiredModal } from "./auth/modals/SessionExpiredModal.tsx";

type Phase = "loading" | "setup" | "login" | "ready";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const [warning, setWarning] = useState<{ secondsRemaining: number } | null>(null);
  const [expired, setExpired] = useState(false);

  const provider = useMemo(() => new CookieAuthProvider(), []);
  const managerRef = useRef<SessionManager | null>(null);
  if (!managerRef.current) managerRef.current = new SessionManager(provider);
  const manager = managerRef.current;

  useEffect(() => {
    setApiSessionManager(manager);

    const unsub = manager.subscribe((e: SessionEvent) => {
      if (e.type === "state") setState(e.state);
      else if (e.type === "idle-warning") setWarning({ secondsRemaining: e.secondsRemaining });
      else if (e.type === "idle-warning-cleared") setWarning(null);
      else if (e.type === "session-expired") setExpired(true);
    });

    let cancelled = false;
    (async () => {
      const status = await fetch("/api/bootstrap/status").then((r) => r.json()).catch(() => null);
      if (cancelled) return;
      if (!status?.bootstrapped) { setPhase("setup"); return; }
      await manager.start();
    })();

    return () => {
      cancelled = true;
      unsub();
      manager.stop();
      setApiSessionManager(null);
    };
  }, [manager]);

  // Map manager state into the existing phase machine
  useEffect(() => {
    if (phase === "setup") return;
    if (state.status === "loading") setPhase("loading");
    else if (state.status === "anonymous") setPhase("login");
    else setPhase("ready");
  }, [state, phase]);

  async function handleLogin(username: string, password: string): Promise<void> {
    await manager.login(username, password);
    setExpired(false);
  }

  async function handleLogout(): Promise<void> {
    await manager.logout();
  }

  async function handleExtend(): Promise<void> {
    await manager.extend();
  }

  async function handleRefresh(): Promise<void> {
    await manager.refresh();
  }

  if (phase === "loading") return null;
  if (phase === "setup")   return <SetupWizardPage onDone={() => setPhase("login")} />;
  if (phase === "login")   {
    return (
      <>
        <LoginPage onLoggedIn={() => { /* manager state drives transition */ }} onLogin={handleLogin} />
        {expired && <SessionExpiredModal onDismiss={() => setExpired(false)} />}
      </>
    );
  }

  const session = state.status === "authenticated" ? state.session : null;
  const user: AuthUser | null = session
    ? { id: session.user.sub, username: session.user.preferred_username, displayName: session.user.name }
    : null;
  const org: AuthOrg | null = session?.org ?? null;

  return (
    <AuthContext.Provider
      value={{
        activeOrgId: org?.id ?? "",
        role: session?.role ?? "",
        isPlatformAdmin: session?.user.isPlatformAdmin ?? false,
        user,
        org,
        exp: session?.exp ?? 0,
        logout: handleLogout,
        refresh: handleRefresh,
        extend: handleExtend,
      }}
    >
      {children}
      {warning && (
        <IdleWarningModal
          secondsRemaining={warning.secondsRemaining}
          onStay={handleExtend}
          onSignOut={handleLogout}
        />
      )}
    </AuthContext.Provider>
  );
}
```

> **Adjust `LoginPage`** if it doesn't already accept `onLogin`. If the existing `LoginPage` posts directly to `/api/auth/login`, change it to call `props.onLogin(username, password)` instead. (This keeps `provider.login()` as the single login entry point so the manager seeds `exp`.)

- [ ] **Step 2: Update `LoginPage` props**

Open `packages/web/src/routes/LoginPage.tsx`. If its submit handler currently calls `fetch("/api/auth/login", ...)`, replace that call with `await props.onLogin(username, password)`. Add `onLogin: (username: string, password: string) => Promise<void>` to its props type. Keep `onLoggedIn` as-is (call it after `onLogin` resolves).

---

## Task 8: `IdleWarningModal`

**Files:**
- Create: `packages/web/src/auth/modals/IdleWarningModal.tsx`

- [ ] **Step 1: Create the file**

```tsx
// packages/web/src/auth/modals/IdleWarningModal.tsx
import { useEffect, useState } from "react";

interface Props {
  secondsRemaining: number;
  onStay: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

export function IdleWarningModal({ secondsRemaining, onStay, onSignOut }: Props) {
  const [seconds, setSeconds] = useState(secondsRemaining);
  useEffect(() => { setSeconds(secondsRemaining); }, [secondsRemaining]);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
    >
      <div className="w-[420px] rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 id="idle-warning-title" className="text-lg font-semibold text-slate-100">
          Your session is about to expire
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          You'll be signed out in <span className="font-mono">{mm}:{ss}</span> due to inactivity.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { void onSignOut(); }}
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            Sign out now
          </button>
          <button
            type="button"
            onClick={() => { void onStay(); }}
            className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 9: `SessionExpiredModal`

**Files:**
- Create: `packages/web/src/auth/modals/SessionExpiredModal.tsx`

- [ ] **Step 1: Create the file**

```tsx
// packages/web/src/auth/modals/SessionExpiredModal.tsx
interface Props {
  onDismiss: () => void;
}

export function SessionExpiredModal({ onDismiss }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
    >
      <div className="w-[420px] rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 id="session-expired-title" className="text-lg font-semibold text-slate-100">
          Your session has expired
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          For your security, please sign in again to continue.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## Task 10: Final typecheck

- [ ] **Step 1: Run typecheck**

```bash
npm --workspace @journeyman/web run typecheck
```

Expected: exit code 0, no errors.

If errors:
- Look at each error.
- Fix without weakening types (no `any`, no `@ts-ignore`).
- Re-run until clean.

---

## Spec coverage check

| Spec section | Implemented in |
|---|---|
| `AuthProvider` interface | Task 1 |
| `CookieAuthProvider` + `expiresAt`→`exp` adapter | Task 2 |
| `BroadcastChannel('auth')` | Task 3 |
| Proactive refresh (`exp − leeway`) | Task 4 (`scheduleRefresh`) |
| Reactive 401 interceptor + shared in-flight refresh | Task 5 + Task 4 (`refresh`) |
| Idle 30-min timeout + 60s warning | Task 4 (`tickIdle`) + Task 8 |
| Activity throttling, passive listeners, no auto-dismiss while modal open | Task 4 (`onActivity`) |
| Visibility handling | Task 4 (`onVisibility`) |
| 5xx refresh retry (1s, 3s); 401/403 immediate failure | Task 4 (`runRefresh`) |
| Logout race (suppress modal during intentional logout) | Task 4 (`loggingOut` flag + interceptor skip on `/api/auth/`) |
| Cross-tab `session-started` / `session-refreshed` / `logout` | Task 4 (`onBroadcast`) + Task 3 |
| `<IdleWarningModal>` | Task 8 |
| `<SessionExpiredModal>` | Task 9 |
| AuthContext extension | Task 6 |
| Final typecheck | Task 10 |

---

## Execution

Plan complete and saved to [`docs/superpowers/plans/2026-04-29-web-session-management.md`](docs/superpowers/plans/2026-04-29-web-session-management.md).
