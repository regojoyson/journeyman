// packages/web/src/auth/SessionManager.ts
import { AuthProvider, Session } from "./AuthProvider.js";
import { AuthBroadcaster, AuthBroadcastEvent, createAuthBroadcaster } from "./broadcast.js";

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
    this.unsubBroadcast = this.broadcaster.subscribe((e: AuthBroadcastEvent) => this.onBroadcast(e));
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
    if (this.state.status !== "authenticated") {
      throw new Error("not authenticated");
    }
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
    if (!exp || exp <= 0) return;
    const nowMs = Date.now();
    const fireAtMs = (exp - this.provider.config.refreshLeewaySeconds) * 1000;
    const delay = Math.max(0, fireAtMs - nowMs);
    this.refreshTimer = setTimeout(() => { void this.refresh().catch(() => { /* swallow */ }); }, delay);
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
      void this.provider.getSession().then((s: Session | null) => {
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
    const wasAuthenticated = this.state.status === "authenticated";
    this.dismissWarning();
    this.clearRefreshTimer();
    this.stopIdleTicker();
    this.setState({ status: "anonymous" });
    if (wasAuthenticated) {
      this.emit({ type: "session-expired" });
      this.broadcaster.post({ type: "logout" });
    }
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
