import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { sandboxesApi, type Sandbox } from "../api/sandboxes.ts";
import { SandboxFormModal } from "../components/sandboxes/SandboxFormModal.tsx";

function ImageStateBadge({ state, error }: { state?: string; error?: string | null }) {
  if (!state || state === "none") return <span className="text-slate-600">—</span>;
  const map: Record<string, string> = {
    pending: "bg-warning/10 text-warning",
    building: "bg-warning/10 text-warning",
    ready: "bg-success/10 text-success",
    failed: "bg-danger/10 text-danger",
  };
  const label = state === "building" ? "building…" : state;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs ${map[state] ?? "bg-slate-800 text-slate-300"}`}
      title={state === "failed" && error ? error : undefined}
    >
      {label}
    </span>
  );
}

export function SandboxesPage(props: { orgId: string; scope: "user" | "org" }) {
  const [rows, setRows] = useState<Sandbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Sandbox | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(props.scope === "user" ? await sandboxesApi.listMy(props.orgId) : await sandboxesApi.listOrg(props.orgId));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [props.orgId, props.scope]);

  async function remove(row: Sandbox) {
    if (!confirm(`Delete sandbox "${row.name}"?`)) return;
    if (props.scope === "user") await sandboxesApi.removeMy(props.orgId, row.id);
    else await sandboxesApi.removeOrg(props.orgId, row.id);
    refresh();
  }

  async function rebuild(row: Sandbox) {
    if (props.scope === "user") await sandboxesApi.rebuildMy(props.orgId, row.id);
    else await sandboxesApi.rebuildOrg(props.orgId, row.id);
    refresh();
  }

  const title = props.scope === "user" ? "My Sandboxes" : "Org Sandboxes";

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
            <p className="mt-1 text-sm text-slate-400">Sandboxes your workflows can run on.</p>
          </div>
          <button onClick={() => setCreating(true)} className={btnPrimary}>+ New sandbox</button>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-base font-medium text-slate-100">
              Sandboxes <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No sandboxes yet. Use "New sandbox" above.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Type</th>
                  <th className="text-left font-medium px-6 py-3">Mode</th>
                  <th className="text-left font-medium px-6 py-3">Image</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-hover">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.type}</td>
                    <td className="px-6 py-3 text-slate-300">{r.executionMode}</td>
                    <td className="px-6 py-3">
                      {r.type === "docker"
                        ? <ImageStateBadge state={r.imageState} error={r.imageError} />
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {r.type === "docker" && r.imageState && r.imageState !== "none" && (
                          <button onClick={() => rebuild(r)} className={btnGhost}>Rebuild</button>
                        )}
                        <button onClick={() => setEditing(r)} className={btnGhost}>Edit</button>
                        <button onClick={() => remove(r)} className={btnDanger}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {creating && (
        <SandboxFormModal orgId={props.orgId} scope={props.scope} onClose={() => setCreating(false)} onSaved={refresh} />
      )}
      {editing && (
        <SandboxFormModal orgId={props.orgId} scope={props.scope} worker={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  );
}
