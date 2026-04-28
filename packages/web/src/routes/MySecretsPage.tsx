import { useEffect, useState } from "react";
import { btnDanger, btnPrimary, card, codePill, inputCls } from "./admin-styles.ts";

interface SecretRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export function MySecretsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const base = `/api/orgs/${props.orgId}/users/me/secrets`;

  async function refresh() {
    setLoading(true);
    const r = await fetch(base, { credentials: "include" });
    if (r.ok) setRows(await r.json());
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await fetch(base, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value, description: description || undefined }),
      });
      if (!r.ok) { setError((await r.json()).error ?? "Failed"); return; }
      setName(""); setValue(""); setDescription("");
      refresh();
    } finally { setBusy(false); }
  }

  async function remove(id: string, secretName: string) {
    if (!confirm(`Delete secret "${secretName}"?`)) return;
    const r = await fetch(`${base}/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">My Secrets</h1>
          <p className="mt-1 text-sm text-slate-400">
            Personal credentials available to your runs. They override org-level and global values.
          </p>
        </header>

        <section className={`${card} p-6`}>
          <h2 className="text-base font-medium text-slate-100 mb-4">Add a secret</h2>
          <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              className={inputCls}
              placeholder="NAME (e.g. GITHUB_TOKEN)"
              value={name}
              onChange={e => setName(e.target.value.toUpperCase())}
              required
            />
            <input
              className={inputCls}
              placeholder="value"
              type="password"
              value={value}
              onChange={e => setValue(e.target.value)}
              required
            />
            <input
              className={inputCls}
              placeholder="description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
            <div className="sm:col-span-3 flex items-center gap-3">
              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? "Saving…" : "Add secret"}
              </button>
              {error && <span className="text-sm text-rose-400">{error}</span>}
            </div>
          </form>
        </section>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-medium text-slate-100">
              Your secrets <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No personal secrets yet. Add one above to override org or global defaults.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Description</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.description ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => remove(r.id, r.name)} className={btnDanger}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
