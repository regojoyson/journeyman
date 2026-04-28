import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RunsList, type RunFilter } from "@journeyman/runs-list";
import type { Run, RunListScope } from "@journeyman/core";
import { listRuns, rerunRun } from "../api/runs.ts";
import { useAuth } from "../AuthContext.tsx";

export function RunsListPage() {
  const [filter, setFilter] = useState<RunFilter>({});
  const [scope, setScope] = useState<RunListScope>("mine");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const auth = useAuth();

  const q = useQuery({
    queryKey: ["runs", filter, scope],
    queryFn: () => listRuns({ status: filter.status, flowId: filter.flowId, scope }),
    refetchInterval: 4000,
  });

  const rerunM = useMutation({
    mutationFn: (r: Run) => rerunRun(r.id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      navigate(`/runs/${res.runId}`);
    },
  });

  return (
    <RunsList
      runs={q.data ?? []}
      isLoading={q.isLoading}
      filter={filter}
      onFilterChange={setFilter}
      onSelectRun={(id) => navigate(`/runs/${id}`)}
      onRerun={(r) => rerunM.mutate(r)}
      scope={scope}
      onScopeChange={setScope}
      showOrgChip={!!auth.activeOrgId}
      showAllChip={auth.isPlatformAdmin}
    />
  );
}
