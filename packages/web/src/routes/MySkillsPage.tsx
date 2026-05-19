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

  const sharedPathCounts = rows.reduce<Record<string, number>>((acc, r) => {
    if (r.localPath) acc[r.localPath] = (acc[r.localPath] ?? 0) + 1;
    return acc;
  }, {});

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

        <section className={card}>
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
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col style={{ width: "30%" }} />
                <col style={{ width: "90px" }} />
                <col style={{ width: "auto" }} />
                <col style={{ width: "150px" }} />
                <col style={{ width: "290px" }} />
              </colgroup>
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
                    <td className="px-6 py-3 align-middle">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <code className={`${codePill} truncate`}>{r.name}</code>
                          {r.localPath && (sharedPathCounts[r.localPath] ?? 0) > 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300">
                              shared ({sharedPathCounts[r.localPath]})
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500 truncate" title={r.gitUrl}>{r.gitUrl}</div>
                      </div>
                    </td>
                    <td className="px-6 py-3">
                      <span className={statusColor(r.installStatus)}>{r.installStatus}</span>
                    </td>
                    <td className="px-6 py-3 text-slate-300 align-middle">
                      {r.enabledSkills.length === 0 ? (
                        <span className="text-slate-500">all</span>
                      ) : (
                        <div className="relative group inline-block max-w-full">
                          <div className="truncate cursor-help">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 mr-2">
                              {r.enabledSkills.length}
                            </span>
                            <span className="text-slate-400">
                              {r.enabledSkills.slice(0, 3).join(", ")}
                              {r.enabledSkills.length > 3 ? ` +${r.enabledSkills.length - 3} more` : ""}
                            </span>
                          </div>
                          <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-opacity absolute left-0 top-full mt-1 z-20 w-80 max-h-72 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 shadow-xl p-3">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
                              {r.enabledSkills.length} enabled
                            </div>
                            <ul className="space-y-1">
                              {r.enabledSkills.map((s) => (
                                <li key={s} className="text-xs text-slate-300 font-mono">
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-slate-400 whitespace-nowrap text-xs">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right align-middle whitespace-nowrap">
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
