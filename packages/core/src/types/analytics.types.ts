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

// ---- usage & cost dashboard ----
export type UsageDimensionKey =
  | "model" | "provider" | "agent" | "workflow" | "workflow_version" | "step";

export interface UsageTotals {
  rows: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number | null;
  unpricedRows: number;
}

export interface UsageSummary extends UsageTotals {
  runs: number;
  costPerRun: number | null;
  cacheReadHitRatio: number;
  cacheSavingsUsd: number | null;
  /** Same totals for the immediately-preceding window, for deltas. */
  previous: UsageTotals & { runs: number };
}

export interface UsageTimeseriesPoint {
  day: string;
  costUsd: number | null;
  totalTokens: number;
}

export interface UsageBreakdownRow {
  key: string;
  label: string;
  costUsd: number | null;
  totalTokens: number;
  runs: number;
  costPerRun: number | null;
  cacheReadHitRatio: number;
  /** Earliest created_at in the group — used to order workflow versions chronologically. */
  firstSeen: string | null;
}

export interface UsageWaste {
  costUsd: number | null;
  totalTokens: number;
  rows: number;
  fractionOfTotalCost: number | null;
  topAgent: { agentId: string | null; agentName: string | null; costUsd: number | null } | null;
  /** Failed/cancelled workflow instances that recorded no priced cost (no row with cost_usd>0). */
  failedRunsNoCost: number;
}

export interface UsageInstanceStep {
  nodeId: string;
  stepType: string;
  stepName: string | null;
  attempt: number;
  outcome: string;
  model: string | null;
  totalTokens: number;
  costUsd: number | null;
}

export interface UsageInstanceDetail {
  instanceId: string;
  costUsd: number | null;
  totalTokens: number;
  steps: UsageInstanceStep[];
}
