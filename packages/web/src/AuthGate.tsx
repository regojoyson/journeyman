import { useEffect, useState } from "react";
import { SetupWizardPage } from "./routes/SetupWizardPage.tsx";
import { LoginPage } from "./routes/LoginPage.tsx";
import { AuthContext, type AuthOrg, type AuthUser } from "./AuthContext.tsx";

type Phase = "loading" | "setup" | "login" | "ready";

interface MePayload {
  user?: { id: string; username: string; displayName: string | null; isPlatformAdmin?: boolean };
  activeOrg?: { id: string; slug?: string; name?: string };
  role?: string;
  isPlatformAdmin?: boolean;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [activeOrgId, setActiveOrgId] = useState("");
  const [role, setRole] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [org, setOrg] = useState<AuthOrg | null>(null);

  async function check() {
    try {
      const status = await fetch("/api/bootstrap/status").then(r => r.json());
      if (!status.bootstrapped) { setPhase("setup"); return; }
      const meRes = await fetch("/api/auth/me", { credentials: "include" });
      if (!meRes.ok) { setPhase("login"); return; }
      const me: MePayload = await meRes.json();
      setActiveOrgId(me.activeOrg?.id ?? "");
      setRole(me.role ?? "");
      setIsPlatformAdmin(me.isPlatformAdmin ?? me.user?.isPlatformAdmin ?? false);
      setUser(me.user
        ? { id: me.user.id, username: me.user.username, displayName: me.user.displayName ?? null }
        : null);
      setOrg(me.activeOrg
        ? { id: me.activeOrg.id, slug: me.activeOrg.slug, name: me.activeOrg.name }
        : null);
      setPhase("ready");
    } catch {
      setPhase("login");
    }
  }
  useEffect(() => { check(); }, []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch { /* ignore — fall through to login regardless */ }
    setUser(null); setOrg(null); setActiveOrgId(""); setRole(""); setIsPlatformAdmin(false);
    setPhase("login");
  }

  if (phase === "loading") return null;
  if (phase === "setup")   return <SetupWizardPage onDone={() => setPhase("login")} />;
  if (phase === "login")   return <LoginPage onLoggedIn={() => { check(); }} />;
  return (
    <AuthContext.Provider value={{ activeOrgId, role, isPlatformAdmin, user, org, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
