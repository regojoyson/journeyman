import { useEffect, useState } from "react";
import { agentsApi, type AuditEntry } from "../../api/agents.ts";

/** Recent sensitive actions for the org (§16 audit log). */
export function AuditLogPanel({ orgId }: { orgId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    agentsApi
      .audit(orgId, { limit: 50 })
      .then(setEntries)
      .catch((e) => setError(e?.message ?? String(e)));
  }, [orgId]);

  return (
    <section className="rounded-lg border p-4 space-y-3">
      <h2 className="text-base font-medium">Audit log</h2>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!entries ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recorded actions yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">When</th>
              <th className="py-1 font-medium">Action</th>
              <th className="py-1 font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="py-1 text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                <td className="py-1 font-mono text-xs">{e.action}</td>
                <td className="py-1 text-muted-foreground">
                  {e.target_type}
                  {e.target_id ? ` · ${e.target_id.slice(0, 8)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
