import { useEffect, useState, useCallback } from "react";
import { agentsApi } from "../../api/agents.ts";
import type { Agent } from "@journeyman/core";
import { EditAgentModal } from "./EditAgentModal.tsx";
import { btnPrimary, btnGhost, btnDanger, card } from "../../routes/admin-styles.ts";

export function AgentsList({ orgId, scope }: { orgId: string; scope: "user" | "org" }) {
  const [items, setItems] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(scope === "user" ? await agentsApi.listMine(orgId) : await agentsApi.listOrg(orgId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [orgId, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createDraft = async () => {
    try {
      const a = await agentsApi.create(orgId, { scope, name: newName.trim() });
      setCreating(false);
      setNewName("");
      setEditing(a);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold">Agents</h2>
        <button className={btnPrimary} onClick={() => setCreating(true)}>+ Create agent</button>
      </div>
      {error && <div className="px-4 py-2 text-sm text-destructive">{error}</div>}
      {creating && (
        <div className="p-4 flex gap-2 border-b">
          <input
            autoFocus
            className="flex-1 rounded-md border px-3 py-2 text-sm bg-transparent"
            placeholder="Agent name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className={btnPrimary} disabled={!newName.trim()} onClick={createDraft}>Create draft</button>
          <button className={btnGhost} onClick={() => setCreating(false)}>Cancel</button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Triggers</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td className="px-4 py-3" colSpan={4}>Loading…</td>
            </tr>
          )}
          {!loading && items.length === 0 && (
            <tr>
              <td className="px-4 py-3 text-muted-foreground" colSpan={4}>No agents yet</td>
            </tr>
          )}
          {items.map((a) => (
            <tr key={a.id} className="border-t">
              <td className="px-4 py-2 font-medium">{a.name}</td>
              <td className="px-4 py-2">{a.enabled ? "enabled" : a.status}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {a.triggers.map((t) => t.type).join(", ") || "manual"}
              </td>
              <td className="px-4 py-2 text-right">
                <button className={btnGhost} onClick={() => setEditing(a)}>Open</button>
                <button
                  className={btnDanger}
                  onClick={async () => {
                    await agentsApi.remove(orgId, a.id);
                    await refresh();
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <EditAgentModal
          orgId={orgId}
          agent={editing}
          onClose={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
