import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { computeTargetsApi, type ComputeTarget } from "../api/computeTargets.ts";
import { ComputeTargetFormModal } from "../components/compute-targets/ComputeTargetFormModal.tsx";

export function ComputeTargetsPage(props: { orgId: string; scope: "user" | "org" }) {
  const [rows, setRows] = useState<ComputeTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ComputeTarget | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(props.scope === "user" ? await computeTargetsApi.listMy(props.orgId) : await computeTargetsApi.listOrg(props.orgId));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [props.orgId, props.scope]);

  async function remove(row: ComputeTarget) {
    if (!confirm(`Delete compute target "${row.name}"?`)) return;
    if (props.scope === "user") await computeTargetsApi.removeMy(props.orgId, row.id);
    else await computeTargetsApi.removeOrg(props.orgId, row.id);
    refresh();
  }

  const title = props.scope === "user" ? "My Compute Targets" : "Org Compute Targets";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
            <p className="mt-1 text-sm text-slate-400">Compute targets your workflows can run on.</p>
          </div>
          <button onClick={() => setCreating(true)} className={btnPrimary}>+ New compute target</button>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Compute Targets <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No compute targets yet. Use "New compute target" above.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Type</th>
                  <th className="text-left font-medium px-6 py-3">Mode</th>
                  <th className="text-left font-medium px-6 py-3">Default</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.type}</td>
                    <td className="px-6 py-3 text-slate-300">{r.executionMode}</td>
                    <td className="px-6 py-3 text-slate-300">{r.isDefault ? "★" : <span className="text-slate-600">—</span>}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
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
        <ComputeTargetFormModal orgId={props.orgId} scope={props.scope} onClose={() => setCreating(false)} onSaved={refresh} />
      )}
      {editing && (
        <ComputeTargetFormModal orgId={props.orgId} scope={props.scope} worker={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  );
}
