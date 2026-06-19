import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { btnDanger, btnPrimary, card, codePill, inputCls } from "./admin-styles.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";

interface SecretRow {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
interface GlobalRow { name: string; source: "env" }

export function SecretsPage({ tier }: { tier: "workspace" | "org" }) {
  const params = useParams<{ wsId: string; orgId: string }>();
  const { can } = useWorkspace();

  const scopeId = tier === "workspace" ? (params.wsId ?? "") : (params.orgId ?? "");
  const base =
    tier === "workspace"
      ? `/api/workspaces/${scopeId}/secrets`
      : `/api/orgs/${scopeId}/secrets`;

  const canWrite = tier === "org" ? true : can("resource.write");
  const canDelete = tier === "org" ? true : can("resource.delete");

  const [rows, setRows] = useState<SecretRow[]>([]);
  const [globalRows, setGlobalRows] = useState<GlobalRow[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const reqs: Promise<unknown>[] = [
      fetch(base, { credentials: "include" }).then(r => (r.ok ? r.json() : [])),
    ];
    if (tier === "org") {
      reqs.push(fetch("/api/global-secrets", { credentials: "include" }).then(r => (r.ok ? r.json() : [])));
    }
    const [a, b] = await Promise.all(reqs);
    setRows(a as SecretRow[]);
    if (tier === "org") setGlobalRows((b ?? []) as GlobalRow[]);
    setLoading(false);
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [base]);

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
      void refresh();
    } finally { setBusy(false); }
  }

  async function remove(id: string, secretName: string) {
    if (!confirm(`Delete secret "${secretName}"?`)) return;
    const r = await fetch(`${base}/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) void refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Secrets</h1>
          <p className="mt-1 text-sm text-slate-400">
            {tier === "org"
              ? "Shared credentials for everyone in this org. Resolution order at run time: workspace → org → global."
              : "Credentials available to runs in this workspace."}
          </p>
        </header>

        {tier === "org" && (
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
        )}

        {canWrite && (
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
                {error && <span className="text-sm text-danger">{error}</span>}
              </div>
            </form>
          </section>
        )}

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-base font-medium text-slate-100">
              Secrets <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No secrets yet.
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
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-surface-hover">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.description ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      {canDelete && (
                        <button onClick={() => remove(r.id, r.name)} className={btnDanger}>Delete</button>
                      )}
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
