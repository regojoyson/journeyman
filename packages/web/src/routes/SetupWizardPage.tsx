import { useState } from "react";

export function SetupWizardPage(props: { onDone: () => void }) {
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, orgSlug, username, password }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Bootstrap failed");
      props.onDone();
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  const inputCls =
    "w-full rounded-md bg-slate-800/80 border border-slate-700 px-3 py-2 text-slate-100 " +
    "placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 " +
    "focus:ring-1 focus:ring-indigo-400 transition";

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-slate-900/60 backdrop-blur border border-slate-800 rounded-xl p-8 shadow-xl space-y-5"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-100">First-time setup</h1>
          <p className="text-sm text-slate-400">
            Create your organization and the first admin account.
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm text-slate-300 mb-1">Organization name</span>
              <input
                className={inputCls}
                placeholder="Acme Inc."
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                autoFocus
                required
              />
            </label>
            <label className="block">
              <span className="block text-sm text-slate-300 mb-1">Slug</span>
              <input
                className={inputCls}
                placeholder="acme"
                value={orgSlug}
                onChange={e => setOrgSlug(e.target.value)}
                pattern="[a-z0-9-]+"
                title="Lowercase letters, digits, and dashes"
                required
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-sm text-slate-300 mb-1">Admin username</span>
            <input
              className={inputCls}
              placeholder="admin"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="block">
            <span className="block text-sm text-slate-300 mb-1">Admin password</span>
            <input
              className={inputCls}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
            {error}
          </div>
        )}

        <button
          disabled={busy}
          type="submit"
          className="w-full rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2 transition"
        >
          {busy ? "Creating…" : "Create organization"}
        </button>
      </form>
    </div>
  );
}
