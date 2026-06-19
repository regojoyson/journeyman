import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { mcpApi, type McpInstance } from "../api/mcp.ts";
import { AddFromCatalogModal } from "../components/mcp/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/mcp/AddCustomModal.tsx";
import { EditMcpModal } from "../components/mcp/EditMcpModal.tsx";
import { TestMcpModal } from "../components/mcp/TestMcpModal.tsx";

export function AdminMcpsPage(props: { orgId: string }) {
  const [rows, setRows] = useState<McpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<McpInstance | null>(null);
  const [testing, setTesting] = useState<McpInstance | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setRows(await mcpApi.list(""));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function remove(row: McpInstance) {
    if (!confirm(`Delete org MCP "${row.name}"?`)) return;
    await mcpApi.remove("", row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Org MCPs</h1>
            <p className="mt-1 text-sm text-slate-400">
              Org-wide MCPs visible to everyone in this organization.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setModal("catalog")} className={btnGhost}>+ Add from catalog</button>
            <button onClick={() => setModal("custom")} className={btnPrimary}>+ Add custom</button>
          </div>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="text-base font-medium text-slate-100">
              Org MCPs <span className="text-slate-500 font-normal">({rows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No org MCPs yet.</div>
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
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.bindings.length === 0 ? <span className="text-slate-600">—</span> : `${r.bindings.length} secret${r.bindings.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setTesting(r)} className={btnGhost}>Test</button>
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

      {modal === "catalog" && (
        <AddFromCatalogModal wsId={""} onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {modal === "custom" && (
        <AddCustomModal wsId={""} onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {editing && (
        <EditMcpModal wsId={""} mcp={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {testing && (
        <TestMcpModal wsId={""} mcp={testing} onClose={() => setTesting(null)} />
      )}
    </div>
  );
}
