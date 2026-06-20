import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { agentsApi, type AgentRunEnriched, type AgentRunsPage } from "../api/agents.ts";
import type { Agent } from "@journeyman/core";
import { AgentRunsList } from "../components/agents/AgentRunsList.tsx";

export function AgentRunsPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");

  const [result, setResult] = useState<AgentRunsPage | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try { setAgents(await agentsApi.list(wsId)); } catch { /* non-fatal */ }
  }, [wsId]);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentsApi.listRuns(wsId, {
        status:   statusFilter || undefined,
        agentId:  agentFilter  || undefined,
        trigger:  triggerFilter || undefined,
        page,
        pageSize: 20,
      });
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wsId, statusFilter, agentFilter, triggerFilter, page]);

  useEffect(() => { void loadAgents(); }, [loadAgents]);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const handleStatusFilter  = (s: string)  => { setStatusFilter(s);  setPage(1); };
  const handleAgentFilter   = (id: string) => { setAgentFilter(id);  setPage(1); };
  const handleTriggerFilter = (t: string)  => { setTriggerFilter(t); setPage(1); };

  const handleRerun = async (run: AgentRunEnriched) => {
    try {
      await agentsApi.runNow(wsId, run.agentId, run.inputs);
      void loadRuns();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (error) {
    return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>{error}</div>;
  }

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <AgentRunsList
        runs={result?.runs ?? []}
        total={result?.total ?? 0}
        page={result?.page ?? 1}
        pageSize={result?.pageSize ?? 20}
        isLoading={loading}
        statusFilter={statusFilter}
        agentFilter={agentFilter}
        triggerFilter={triggerFilter}
        agents={agents.map(a => ({ id: a.id, name: a.name }))}
        onStatusFilter={handleStatusFilter}
        onAgentFilter={handleAgentFilter}
        onTriggerFilter={handleTriggerFilter}
        onPageChange={setPage}
        onSelectRun={id => navigate(`/workspaces/${wsId}/agent-runs/${id}`)}
        onRerun={handleRerun}
      />
    </div>
  );
}
