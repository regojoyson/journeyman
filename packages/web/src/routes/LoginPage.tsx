import { useState } from "react";
import { Logo } from "../components/Logo.tsx";

export function LoginPage(props: {
  onLoggedIn: () => void;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await props.onLogin(username, password);
      props.onLoggedIn();
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
        className="w-full max-w-sm bg-slate-900/60 backdrop-blur border border-slate-800 rounded-xl p-8 shadow-xl space-y-5"
      >
        <div className="flex justify-center text-slate-100">
          <Logo height={64} />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-slate-100">Sign in</h1>
          <p className="text-sm text-slate-400">Welcome back to Journeyman.</p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-sm text-slate-300 mb-1">Username</span>
            <input
              className={inputCls}
              placeholder="your-username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              required
            />
          </label>
          <label className="block">
            <span className="block text-sm text-slate-300 mb-1">Password</span>
            <input
              className={inputCls}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
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
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
