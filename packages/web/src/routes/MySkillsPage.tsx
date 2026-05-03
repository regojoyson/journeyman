import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { skillsApi, type SkillPackage } from "../api/skills.ts";
import { AddFromCatalogModal } from "../components/skills/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/skills/AddCustomModal.tsx";
import { EditSkillsModal } from "../components/skills/EditSkillsModal.tsx";

export function MySkillsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<SkillPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<SkillPackage | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await skillsApi.listMy(props.orgId));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function pull(row: SkillPackage) {
    setPulling(row.id);
    try {
      await skillsApi.pullMy(props.orgId, row.id);
      await refresh();
    } finally {
      setPulling(null);
    }
  }

  async function remove(row: SkillPackage) {
    if (!confirm(`Delete skill package "${row.name}"?`)) return;
    await skillsApi.removeMy(props.orgId, row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">My Skills</h1>
            <p className="mt-1 text-sm text-slate-400">
              Personal Claude Code skill packages available to your runs.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal("catalog")} className={btnGhost}>+ From catalog</button>
            <button onClick={() => setModal("custom")} className={btnPrimary}>+ Custom URL</button>
          </div>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Your packages <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No personal skill packages yet. Add from the catalog or provide a custom git URL.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-left font-medium px-6 py-3">Skills enabled</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3">
                      <div>
                        <code className={codePill}>{r.name}</code>
                        <div className="mt-0.5 text-xs text-slate-500 truncate max-w-xs">{r.gitUrl}</div>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={statusColor(r.installStatus)}>{r.installStatus}</span>
                    </td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.enabledSkills.length === 0
                        ? <span className="text-slate-500">all</span>
                        : r.enabledSkills.join(", ")}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => pull(r)}
                          disabled={pulling === r.id}
                          className={btnGhost}
                        >
                          {pulling === r.id ? "Pulling…" : "Pull latest"}
                        </button>
                        <button onClick={() => setEditing(r)} className={btnGhost}>Configure</button>
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

      {modal === "catalog" && (
        <AddFromCatalogModal orgId={props.orgId} scope="user" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {modal === "custom" && (
        <AddCustomModal orgId={props.orgId} scope="user" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {editing && (
        <EditSkillsModal orgId={props.orgId} pkg={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  );
}

function statusColor(status: string) {
  const base = "text-xs font-medium px-2 py-0.5 rounded-full ";
  if (status === "ready") return base + "bg-emerald-900/40 text-emerald-400";
  if (status === "error") return base + "bg-rose-900/40 text-rose-400";
  if (status === "installing") return base + "bg-amber-900/40 text-amber-400";
  return base + "bg-slate-800 text-slate-400";
}
