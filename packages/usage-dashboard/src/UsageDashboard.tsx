import type { CSSProperties, ReactNode } from "react";
import type {
  AnalyticsWindow, UsageSummary, UsageTimeseriesPoint, UsageBreakdownRow,
  UsageWaste, UsageDimensionKey,
} from "@journeyman/core";
import { Card, Bars, HBars, Donut, Sparkline, COLORS } from "./widgets.tsx";
import { formatUsd, formatTokens, pctDelta } from "./format.ts";
import { detectVersionRegression } from "./regression.ts";
import { tokenMixSegments, cumulativeSpend, costShareSegments } from "./usage-charts.ts";

export interface UsageDashboardProps {
  window: AnalyticsWindow;
  onWindowChange: (w: AnalyticsWindow) => void;
  groupBy: UsageDimensionKey;
  onGroupByChange: (d: UsageDimensionKey) => void;
  summary: UsageSummary | null;
  timeseries: UsageTimeseriesPoint[];
  breakdown: UsageBreakdownRow[];
  waste: UsageWaste | null;
  workspaceName?: string;
  loading?: boolean;
}

const GRID: CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16,
};

const WINDOWS: AnalyticsWindow[] = ["30d", "7d", "24h"];
const GROUPS: UsageDimensionKey[] = ["model", "agent", "workflow", "workflow_version", "step"];

export function UsageDashboard(p: UsageDashboardProps) {
  const s = p.summary;
  const costDelta = s ? pctDelta(s.costUsd ?? 0, s.previous.costUsd ?? 0) : null;
  const maxCost = Math.max(1, ...p.breakdown.map((b) => b.costUsd ?? 0));
  const maxCostPerRun = Math.max(1e-9, ...p.breakdown.map((b) => b.costPerRun ?? 0));

  // Version regression: when grouping by workflow_version, order versions chronologically
  // (by first appearance) and flag when the newest version's $/run jumped >25% over the prior one.
  const regression = p.groupBy === "workflow_version"
    ? detectVersionRegression(
        [...p.breakdown]
          .sort((a, b) => (a.firstSeen ?? "").localeCompare(b.firstSeen ?? ""))
          .map((b) => ({ label: b.label, costPerRun: b.costPerRun })),
        0.25,
      )
    : null;

  return (
    <div style={{ fontSize: 14 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Usage &amp; cost</h2>
          <div style={{ opacity: 0.6, fontSize: 13 }}>workspace · {p.workspaceName ?? "—"}</div>
        </div>
        {/* Segmented pill range toggle (Option A from the spec) */}
        <div style={{ display: "inline-flex", border: "1px solid rgba(127,127,127,.25)", borderRadius: 8, padding: 2 }}>
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => p.onWindowChange(w)}
              style={{ border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer",
                background: w === p.window ? COLORS.BLUE : "transparent",
                color: w === p.window ? "#031227" : "inherit" }}>{w}</button>
          ))}
        </div>
      </header>

      {/* Group-by pill row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>Group by</span>
        {GROUPS.map((g) => (
          <button key={g} onClick={() => p.onGroupByChange(g)}
            style={{ border: "1px solid rgba(127,127,127,.25)", borderRadius: 999, padding: "4px 12px",
              cursor: "pointer", fontSize: 12,
              background: g === p.groupBy ? COLORS.BLUE : "transparent",
              color: g === p.groupBy ? "#031227" : "inherit" }}>{g}</button>
        ))}
      </div>

      {s && s.unpricedRows > 0 && (
        <div style={{ fontSize: 12, background: "rgba(255,194,75,.12)", borderRadius: 8, padding: "8px 12px", marginBottom: 16 }}>
          {s.unpricedRows} usage rows are unpriced (no matching model price). Set pricing in admin → coding models.
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Kpi label="Total cost" value={formatUsd(s?.costUsd ?? null)}
          sub={costDelta === null ? undefined : `${costDelta >= 0 ? "+" : ""}${costDelta}% vs prev`} />
        <Kpi label="Total tokens" value={s ? formatTokens(s.totalTokens) : "—"} />
        <Kpi label="Avg cost / run" value={formatUsd(s?.costPerRun ?? null)} sub={s ? `${s.runs} runs` : undefined} />
        <Kpi label="Cache hit ratio" value={s ? `${Math.round(s.cacheReadHitRatio * 100)}%` : "—"} />
      </div>

      {/* ── Spend ─────────────────────────────────────────────── */}
      <SectionLabel>Spend</SectionLabel>
      <div style={GRID}>
        <Card title="Cost over time" cap="daily · USD">
          <Bars bars={p.timeseries.map((t) => ({ label: t.day, value: t.costUsd ?? 0 }))} />
        </Card>
        <Card title="Cumulative spend" cap="running total · USD">
          <Sparkline points={cumulativeSpend(p.timeseries)} />
        </Card>
        <Card title={`Cost by ${p.groupBy}`} cap="total · USD">
          <HBars rows={p.breakdown.map((b) => ({
            label: b.label, frac: (b.costUsd ?? 0) / maxCost, valueText: formatUsd(b.costUsd),
            title: `${b.label} · ${formatUsd(b.costUsd)} · ${b.runs} runs`,
          }))} />
        </Card>
        <Card title="Cost share" cap={`by ${p.groupBy} · % of spend`}>
          <Donut segments={costShareSegments(p.breakdown)} />
        </Card>
        <Card title={`Cost per run by ${p.groupBy}`} cap="unit cost · USD / run">
          <HBars rows={p.breakdown.map((b) => ({
            label: b.label, frac: (b.costPerRun ?? 0) / maxCostPerRun, valueText: formatUsd(b.costPerRun),
            title: `${b.label} · ${formatUsd(b.costPerRun)} / run · ${b.runs} runs`,
          }))} />
        </Card>
      </div>

      {regression?.regressed && (
        <div style={{ marginTop: 16, background: "rgba(255,106,106,.12)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
          Version regression — {regression.latest} costs {regression.increasePct}% more per run than {regression.prior}.
        </div>
      )}

      {p.waste && p.waste.costUsd !== null && (
        <div style={{ marginTop: 16, background: "rgba(255,106,106,.12)", borderRadius: 8, padding: "12px 16px", fontSize: 13 }}>
          Wasted spend — {formatUsd(p.waste.costUsd)} on failed / retried runs
          {p.waste.fractionOfTotalCost !== null && ` (${Math.round(p.waste.fractionOfTotalCost * 100)}% of total)`}.
          {p.waste.topAgent?.agentName && ` ${p.waste.topAgent.agentName} accounts for ${formatUsd(p.waste.topAgent.costUsd)}.`}
        </div>
      )}

      {/* ── Usage ─────────────────────────────────────────────── */}
      <SectionLabel>Usage</SectionLabel>
      <div style={GRID}>
        <Card title="Tokens over time" cap="daily · total tokens">
          <Sparkline points={p.timeseries.map((t) => ({
            value: t.totalTokens, title: `${t.day} · ${formatTokens(t.totalTokens)} tokens`,
          }))} />
        </Card>
        <Card title="Token mix" cap="input · output · cache · reasoning">
          <Donut segments={tokenMixSegments(s)} />
        </Card>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.55, margin: "24px 0 12px" }}>
      {children}
    </h3>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "rgba(127,127,127,.05)", borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 13, opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, opacity: 0.6 }}>{sub}</div>}
    </div>
  );
}
