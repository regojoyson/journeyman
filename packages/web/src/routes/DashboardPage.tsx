import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsWindow } from "@journeyman/core";
import { Dashboard } from "@journeyman/workspace-dashboard";
import { getLiveStats, getOverview } from "../api/analytics.ts";
import { useWorkspace } from "../WorkspaceContext.tsx";

export function DashboardPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const { activeWorkspace } = useWorkspace();
  const [window, setWindow] = useState<AnalyticsWindow>("7d");

  const live = useQuery({
    queryKey: ["analytics-live", wsId],
    queryFn: () => getLiveStats(wsId),
    refetchInterval: 10_000,
    enabled: !!wsId,
  });

  const overview = useQuery({
    queryKey: ["analytics-overview", wsId, window],
    queryFn: () => getOverview(wsId, window),
    enabled: !!wsId,
  });

  return (
    <div className="h-full overflow-y-auto">
      <div style={{ padding: 20 }}>
        <Dashboard
          live={live.data ?? null}
          overview={overview.data ?? null}
          window={window}
          onWindowChange={setWindow}
          loading={overview.isLoading}
          workspaceName={activeWorkspace?.name}
          lastUpdated={live.dataUpdatedAt}
        />
      </div>
    </div>
  );
}
