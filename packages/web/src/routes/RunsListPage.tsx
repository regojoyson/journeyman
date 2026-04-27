import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RunsList, type RunFilter } from "@journeyman/runs-list";
import { listRuns } from "../api/runs.ts";

export function RunsListPage() {
  const [filter, setFilter] = useState<RunFilter>({});
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["runs", filter],
    queryFn: () => listRuns({ status: filter.status, flowId: filter.flowId }),
    refetchInterval: 4000,
  });

  return (
    <RunsList
      runs={q.data ?? []}
      isLoading={q.isLoading}
      filter={filter}
      onFilterChange={setFilter}
      onSelectRun={(id) => navigate(`/runs/${id}`)}
    />
  );
}
