import { useEffect, useState } from "react";
import { agentsApi, type AgentRunSummary } from "../../../api/agents.ts";
import { SectionShell } from "./SectionShell.tsx";

export function RunHistorySection({ wsId, agentId }: { wsId: string; agentId: string }) {
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    agentsApi
      .runs(wsId, agentId)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [wsId, agentId]);

  return (
    <SectionShell title="Run history" description="Past executions of this agent.">
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No runs yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Run</th>
              <th className="py-1">Status</th>
              <th className="py-1">Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1">
                  <a className="text-primary underline" href={`/workspaces/${wsId}/workflow-instances/${r.id}`}>
                    {r.id.slice(0, 8)}
                  </a>
                </td>
                <td className="py-1">{r.status}</td>
                <td className="py-1 text-muted-foreground">{r.started_at ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionShell>
  );
}
