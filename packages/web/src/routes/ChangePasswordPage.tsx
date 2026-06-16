import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { btnGhost, btnPrimary, card, inputCls } from "./admin-styles.ts";

export function ChangePasswordPage() {
  const nav = useNavigate();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmPassword, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    if (newPassword.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setError("New password and confirmation don't match."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/users/me/password", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
      setInfo("Password updated.");
      setCurrent(""); setNew(""); setConfirm("");
    } finally { setBusy(false); }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-10 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Change password</h1>
          <p className="mt-1 text-sm text-slate-400">
            If you signed in with a temporary password, change it here.
          </p>
        </header>

        <form onSubmit={submit} className={`${card} p-6 space-y-4`}>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Current password</label>
            <input
              className={inputCls}
              type="password"
              value={currentPassword}
              onChange={e => setCurrent(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">New password</label>
            <input
              className={inputCls}
              type="password"
              value={newPassword}
              onChange={e => setNew(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Confirm new password</label>
            <input
              className={inputCls}
              type="password"
              value={confirmPassword}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
            />
          </div>

          {error && (
            <div className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-md border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              {info}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Saving…" : "Update password"}
            </button>
            <button type="button" onClick={() => nav(-1)} className={btnGhost}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
