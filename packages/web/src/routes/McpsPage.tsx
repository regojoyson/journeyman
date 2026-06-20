import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { mcpApi, type McpInstance } from "../api/mcp.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";
import { AddFromCatalogModal } from "../components/mcp/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/mcp/AddCustomModal.tsx";
import { EditMcpModal } from "../components/mcp/EditMcpModal.tsx";
import { TestMcpModal } from "../components/mcp/TestMcpModal.tsx";

export function McpsPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { can } = useWorkspace();
  const canWrite = can("resource.write");
  const canDelete = can("resource.delete");

  const [rows, setRows] = useState<McpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<McpInstance | null>(null);
  const [testing, setTesting] = useState<McpInstance | null>(null);

  async function refresh() {
    setLoading(true);
    try { setRows(await mcpApi.list(wsId)); } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wsId]);

  async function remove(row: McpInstance) {
    if (!confirm(`Delete MCP "${row.name}"?`)) return;
    await mcpApi.remove(wsId, row.id);
    void refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">MCPs</h1>
            <p className="mt-1 text-sm text-slate-400">
              MCP servers available to runs in this workspace.
            </p>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <button onClick={() => setModal("catalog")} className={btnGhost}>+ Add from catalog</button>
              <button onClick={() => setModal("custom")} className={btnPrimary}>+ Add custom</button>
            </div>
          )}
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-base font-medium text-slate-100">
              MCPs <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No MCPs yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-subtle text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Transport</th>
                  <th className="text-left font-medium px-6 py-3">Bindings</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 border-t border-slate-700">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-hover">
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <code className={codePill}>{r.name}</code>
                        {r.scope === "global" && (
                          <span title="Global MCP — managed by your platform admin" className="text-slate-400">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                              <path d="M21.721 12.752a9.711 9.711 0 0 0-.945-5.003 12.754 12.754 0 0 1-4.339 2.708 18.991 18.991 0 0 1-.214 4.772 17.165 17.165 0 0 0 5.498-2.477ZM14.634 15.55a17.324 17.324 0 0 0 .332-4.647c-.952.227-1.945.347-2.966.347-1.021 0-2.014-.12-2.966-.347a17.515 17.515 0 0 0 .332 4.647 17.385 17.385 0 0 0 5.268 0ZM9.772 17.119a18.963 18.963 0 0 0 4.456 0A17.182 17.182 0 0 1 12 21.724a17.18 17.18 0 0 1-2.228-4.605ZM7.777 15.23a18.87 18.87 0 0 1-.214-4.774 12.753 12.753 0 0 1-4.34-2.708 9.711 9.711 0 0 0-.944 5.004 17.165 17.165 0 0 0 5.498 2.477ZM21.356 14.752a9.765 9.765 0 0 1-7.478 6.817 18.64 18.64 0 0 0 1.988-4.718 18.627 18.627 0 0 0 5.49-2.098ZM2.644 14.752c1.682.971 3.53 1.688 5.49 2.099a18.64 18.64 0 0 0 1.988 4.718 9.765 9.765 0 0 1-7.478-6.816ZM13.878 2.43a9.755 9.755 0 0 1 6.116 3.986 11.267 11.267 0 0 1-3.746 2.504 18.63 18.63 0 0 0-2.37-6.49ZM12 2.276a17.152 17.152 0 0 1 2.805 7.121c-.897.23-1.837.353-2.805.353-.968 0-1.908-.122-2.805-.353A17.151 17.151 0 0 1 12 2.276ZM10.122 2.43a18.629 18.629 0 0 0-2.37 6.49 11.266 11.266 0 0 1-3.746-2.504 9.754 9.754 0 0 1 6.116-3.985Z" />
                            </svg>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.bindings.length === 0 ? <span className="text-slate-600">—</span> : `${r.bindings.length} secret${r.bindings.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setTesting(r)} className={btnGhost}>Test</button>
                        {canWrite && r.scope !== "global" && <button onClick={() => setEditing(r)} className={btnGhost}>Edit</button>}
                        {canDelete && r.scope !== "global" && <button onClick={() => remove(r)} className={btnDanger}>Delete</button>}
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
        <AddFromCatalogModal wsId={wsId} onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {modal === "custom" && (
        <AddCustomModal wsId={wsId} onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {editing && (
        <EditMcpModal wsId={wsId} mcp={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {testing && (
        <TestMcpModal wsId={wsId} mcp={testing} onClose={() => setTesting(null)} />
      )}
    </div>
  );
}
