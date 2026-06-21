import { api } from "./client.ts";
import type { LiveStats, OverviewStats, AnalyticsWindow } from "@journeyman/core";

export function getLiveStats(wsId: string): Promise<LiveStats> {
  return api<LiveStats>(`/api/analytics/workspaces/${encodeURIComponent(wsId)}/live`);
}

export function getOverview(wsId: string, window: AnalyticsWindow): Promise<OverviewStats> {
  const qs = new URLSearchParams({ window });
  return api<OverviewStats>(
    `/api/analytics/workspaces/${encodeURIComponent(wsId)}/overview?${qs.toString()}`,
  );
}
