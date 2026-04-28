import { useEffect, useState } from "react";
import { SetupWizardPage } from "./routes/SetupWizardPage.tsx";
import { LoginPage } from "./routes/LoginPage.tsx";

type Phase = "loading" | "setup" | "login" | "ready";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");

  async function check() {
    try {
      const status = await fetch("/api/bootstrap/status").then(r => r.json());
      if (!status.bootstrapped) { setPhase("setup"); return; }
      const me = await fetch("/api/auth/me", { credentials: "include" });
      setPhase(me.ok ? "ready" : "login");
    } catch {
      setPhase("login");
    }
  }
  useEffect(() => { check(); }, []);

  if (phase === "loading") return null;
  if (phase === "setup")   return <SetupWizardPage onDone={() => setPhase("login")} />;
  if (phase === "login")   return <LoginPage onLoggedIn={() => setPhase("ready")} />;
  return <>{children}</>;
}
