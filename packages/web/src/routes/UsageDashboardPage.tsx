import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsWindow, UsageDimensionKey } from "@journeyman/core";
import { UsageDashboard } from "@journeyman/usage-dashboard";
import { useWorkspace } from "../WorkspaceContext.tsx";
import {
  getUsageSummary, getUsageTimeseries, getUsageBreakdown, getUsageWaste, getUsageInstance,
} from "../api/usage.ts";

export function UsageDashboardPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { activeWorkspace } = useWorkspace();
  const [window, setWindow] = useState<AnalyticsWindow>("30d");
  const [groupBy, setGroupBy] = useState<UsageDimensionKey>("model");
  const [instanceId, setInstanceId] = useState<string | null>(null);

  const en = { enabled: !!wsId };
  const summary = useQuery({ queryKey: ["usage-summary", wsId, window], queryFn: () => getUsageSummary(wsId, window), ...en });
  const timeseries = useQuery({ queryKey: ["usage-ts", wsId, window], queryFn: () => getUsageTimeseries(wsId, window), ...en });
  const breakdown = useQuery({ queryKey: ["usage-by", wsId, window, groupBy], queryFn: () => getUsageBreakdown(wsId, window, groupBy), ...en });
  const waste = useQuery({ queryKey: ["usage-waste", wsId, window], queryFn: () => getUsageWaste(wsId, window), ...en });
  const instance = useQuery({
    queryKey: ["usage-instance", wsId, instanceId],
    queryFn: () => getUsageInstance(wsId, instanceId!),
    enabled: !!wsId && !!instanceId,
  });

  return (
    <div className="h-full overflow-y-auto">
      <div style={{ padding: 20 }}>
        <UsageDashboard
          window={window} onWindowChange={setWindow}
          groupBy={groupBy} onGroupByChange={setGroupBy}
          summary={summary.data ?? null}
          timeseries={timeseries.data ?? []}
          breakdown={breakdown.data ?? []}
          waste={waste.data ?? null}
          instance={instance.data ?? null}
          onSelectInstance={setInstanceId}
          workspaceName={activeWorkspace?.name}
          loading={summary.isLoading}
        />
      </div>
    </div>
  );
}
