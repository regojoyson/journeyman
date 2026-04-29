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
