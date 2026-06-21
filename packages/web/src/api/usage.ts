import { api } from "./client.ts";
import type {
  AnalyticsWindow, UsageSummary, UsageTimeseriesPoint, UsageBreakdownRow,
  UsageWaste, UsageInstanceDetail, UsageDimensionKey,
} from "@journeyman/core";

const wsBase = (wsId: string) => `/api/analytics/workspaces/${encodeURIComponent(wsId)}/usage`;

export const getUsageSummary = (wsId: string, w: AnalyticsWindow) =>
  api<UsageSummary>(`${wsBase(wsId)}/summary?window=${w}`);
export const getUsageTimeseries = (wsId: string, w: AnalyticsWindow) =>
  api<UsageTimeseriesPoint[]>(`${wsBase(wsId)}/timeseries?window=${w}`);
export const getUsageBreakdown = (wsId: string, w: AnalyticsWindow, d: UsageDimensionKey) =>
  api<UsageBreakdownRow[]>(`${wsBase(wsId)}/by/${d}?window=${w}`);
export const getUsageWaste = (wsId: string, w: AnalyticsWindow) =>
  api<UsageWaste>(`${wsBase(wsId)}/waste?window=${w}`);
export const getUsageInstance = (wsId: string, instanceId: string) =>
  api<UsageInstanceDetail>(`${wsBase(wsId)}/instances/${encodeURIComponent(instanceId)}`);
