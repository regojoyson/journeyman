import { useCallback, useEffect, useState } from "react";
import { agentsApi, type AgentRunsPage } from "../../../api/agents.ts";
import { SectionShell } from "./SectionShell.tsx";
import { RunHistoryTable } from "./RunHistoryTable.tsx";

const PAGE_SIZE = 10;

export function RunHistorySection({ wsId, agentId }: { wsId: string; agentId: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AgentRunsPage | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await agentsApi.listRuns(wsId, { agentId, page, pageSize: PAGE_SIZE });
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [wsId, agentId, page]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  return (
    <SectionShell title="Run history" description="Past executions of this agent, newest first.">
      <RunHistoryTable
        wsId={wsId}
        runs={result?.runs ?? []}
        total={result?.total ?? 0}
        page={result?.page ?? page}
        pageSize={result?.pageSize ?? PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />
    </SectionShell>
  );
}
