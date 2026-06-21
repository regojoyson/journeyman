import type { WorkflowInstanceStatus } from "./workflow-instance.types.ts";

export type AnalyticsWindow = "24h" | "7d" | "30d";

// ---- live ----
export interface ActiveRunsStat {
  running: number;
  queued: number; // pending + provisioning
  paused: number;
  total: number;
}

export interface NeedsAttentionItem {
  instanceId: string;
  name: string;
  state: "paused" | "failed";
  nodeId: string | null;
  ageMs: number;
}

export interface RecentFeedItem {
  instanceId: string;
  name: string;
  status: WorkflowInstanceStatus;
  trigger: string;
  elapsedMs: number;
}

export interface ActiveSandboxesStat {
  total: number;
  byType: Record<string, number>;
}

export interface LiveStats {
  activeRuns: ActiveRunsStat;
  needsAttention: NeedsAttentionItem[];
  recentFeed: RecentFeedItem[];
  activeSandboxes: ActiveSandboxesStat;
}

// ---- overview ----
export interface DayCount {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface OutcomeSplit {
  completed: number;
  failed: number;
  cancelled: number;
  successRate: number; // 0..1
}

export interface DurationStat {
  medianMs: number;
  trend: { day: string; medianMs: number }[];
  deltaPct: number; // (last - first) / first, 0 if insufficient data
}

export interface TokenStat {
  total: number;
  byProvider: Record<string, number>;
  byVendor: Record<string, number>;
  costUsd: number | null; // null this phase
}

export interface FailurePoint {
  nodeId: string | null;
  count: number;
}

export interface AgentInventory {
  total: number;
  active: number;
  draft: number;
  enabled: number;
}

export interface AgentLeaderboardRow {
  agentId: string;
  name: string;
  provider: string | null;
  runs: number;
  tokens: number;
  successRate: number; // 0..1
  avgDurationMs: number;
}

export interface AgentStats {
  inventory: AgentInventory;
  providerMix: Record<string, number>; // fractions, sum ~1
  activityPerDay: DayCount[];
  leaderboard: AgentLeaderboardRow[];
}

export interface OverviewStats {
  window: AnalyticsWindow;
  runVolume: DayCount[];
  outcomeSplit: OutcomeSplit;
  duration: DurationStat;
  byTrigger: Record<string, number>; // fractions, sum ~1
  tokens: TokenStat;
  topFailures: FailurePoint[];
  agents: AgentStats;
}
