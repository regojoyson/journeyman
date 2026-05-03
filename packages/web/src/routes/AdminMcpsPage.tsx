import { useEffect, useState } from "react";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "./admin-styles.ts";
import { mcpApi, type McpInstance, type PromotableRow } from "../api/mcp.ts";
import { AddFromCatalogModal } from "../components/mcp/AddFromCatalogModal.tsx";
import { AddCustomModal } from "../components/mcp/AddCustomModal.tsx";
import { EditMcpModal } from "../components/mcp/EditMcpModal.tsx";
import { PromoteMcpDialog } from "../components/mcp/PromoteMcpDialog.tsx";

export function AdminMcpsPage(props: { orgId: string }) {
  const [orgRows, setOrgRows] = useState<McpInstance[]>([]);
  const [promotable, setPromotable] = useState<PromotableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"catalog" | "custom" | null>(null);
  const [editing, setEditing] = useState<McpInstance | null>(null);
  const [promoting, setPromoting] = useState<PromotableRow | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        mcpApi.listOrg(props.orgId),
        mcpApi.listPromotable(props.orgId),
      ]);
      setOrgRows(a);
      setPromotable(b);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, [props.orgId]);

  async function remove(row: McpInstance) {
    if (!confirm(`Delete org MCP "${row.name}"?`)) return;
    await mcpApi.removeOrg(props.orgId, row.id);
    refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
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
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Org MCPs <span className="text-slate-500 font-normal">({orgRows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : orgRows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No org MCPs yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Transport</th>
                  <th className="text-left font-medium px-6 py-3">Bindings</th>
                  <th className="text-left font-medium px-6 py-3">Updated</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {orgRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">
                      {r.bindings.length === 0 ? <span className="text-slate-600">—</span> : `${r.bindings.length} secret${r.bindings.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-6 py-3 text-slate-400">{new Date(r.updatedAt).toLocaleString()}</td>
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

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800">
            <h2 className="text-base font-medium text-slate-100">
              Promotable from users <span className="text-slate-500 font-normal">({promotable.length})</span>
            </h2>
          </div>
          {promotable.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No user-level MCPs in this org.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Owner</th>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Transport</th>
                  <th className="text-left font-medium px-6 py-3">Bindings</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {promotable.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3 text-slate-300">{r.ownerEmail}</td>
                    <td className="px-6 py-3"><code className={codePill}>{r.name}</code></td>
                    <td className="px-6 py-3 text-slate-300">{r.transport}</td>
                    <td className="px-6 py-3 text-slate-300">{r.bindingCount}</td>
                    <td className="px-6 py-3 text-right">
                      <button onClick={() => setPromoting(r)} className={btnPrimary}>Promote →</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {modal === "catalog" && (
        <AddFromCatalogModal orgId={props.orgId} scope="org" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {modal === "custom" && (
        <AddCustomModal orgId={props.orgId} scope="org" onClose={() => setModal(null)} onCreated={refresh} />
      )}
      {editing && (
        <EditMcpModal orgId={props.orgId} scope="org" mcp={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {promoting && (
        <PromoteMcpDialog orgId={props.orgId} promotable={promoting} onClose={() => setPromoting(null)} onPromoted={refresh} />
      )}
    </div>
  );
}
