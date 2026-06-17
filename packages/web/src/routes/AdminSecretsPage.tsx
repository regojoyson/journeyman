import { useEffect, useState } from "react";
import { btnDanger, btnPrimary, card, codePill, inputCls } from "./admin-styles.ts";

interface OrgSecretRow {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
interface GlobalRow { name: string; source: "env" }

export function AdminSecretsPage(props: { orgId: string }) {
  const [orgRows, setOrgRows] = useState<OrgSecretRow[]>([]);
  const [globalRows, setGlobalRows] = useState<GlobalRow[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const orgBase = `/api/orgs/${props.orgId}/secrets`;

  async function refresh() {
    setLoading(true);
    const [a, b] = await Promise.all([
      fetch(orgBase, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/global-secrets", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]);
    setOrgRows(a);
    setGlobalRows(b);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await fetch(orgBase, {
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
    if (!confirm(`Delete org secret "${secretName}"?`)) return;
    const r = await fetch(`${orgBase}/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Organization Secrets</h1>
          <p className="mt-1 text-sm text-slate-400">
            Shared credentials for everyone in this org. Resolution order at run time:{" "}
            <span className="text-slate-200">user → org → global</span>.
          </p>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="text-base font-medium text-slate-100">Global (server config)</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Read-only. Set via <code className={codePill}>JM_GLOBAL_*</code> env vars on the server.
              </p>
            </div>
            <span className="text-xs text-slate-500">{globalRows.length} configured</span>
          </div>
          {globalRows.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-slate-500">
              No global secrets configured.
            </div>
          ) : (
            <ul className="px-6 py-4 flex flex-wrap gap-2">
              {globalRows.map(g => (
                <li key={g.name}><code className={codePill}>{g.name}</code></li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${card} p-6`}>
          <h2 className="text-base font-medium text-slate-100 mb-4">Add an organization secret</h2>
          <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              className={inputCls}
              placeholder="NAME"
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
              {error && <span className="text-sm text-danger">{error}</span>}
            </div>
          </form>
        </section>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-base font-medium text-slate-100">
              Organization secrets <span className="text-slate-500 font-normal">({orgRows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : orgRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No org secrets yet. Add one above to share defaults across the team.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Description</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {orgRows.map(r => (
                  <tr key={r.id} className="hover:bg-surface-hover">
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
