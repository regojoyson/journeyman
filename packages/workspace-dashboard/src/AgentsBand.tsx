import type { AgentStats } from "@journeyman/core";
import { Card, Bars, HBars, Kpi, COLORS } from "./widgets.tsx";
import { formatTokens, formatDuration } from "./format.ts";

export function AgentsBand({ data }: { data: AgentStats }) {
  const mixMax = Math.max(1e-9, ...Object.values(data.providerMix));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      <Card title="Inventory" cap="workspace roster">
        <Kpi value={data.inventory.total} sub={[
          { n: data.inventory.active, label: "active", color: COLORS.GREEN },
          { n: data.inventory.draft, label: "draft" },
          { n: data.inventory.enabled, label: "enabled" },
        ]} />
      </Card>

      <Card title="Provider / model mix" cap="runs by provider">
        <HBars rows={Object.entries(data.providerMix).map(([label, frac]) => ({
          label, frac: frac / mixMax, valueText: `${Math.round(frac * 100)}%`,
        }))} />
      </Card>

      <Card title="Activity / day" cap="runs across all agents">
        <Bars bars={data.activityPerDay.map((d) => ({ label: d.day, value: d.count }))} />
      </Card>

      <Card title="Leaderboard" cap="per-agent over the window" span>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.5, fontSize: 10, textTransform: "uppercase" }}>
              <th>Agent</th><th>Provider</th>
              <th style={{ textAlign: "right" }}>Runs</th>
              <th style={{ textAlign: "right" }}>Tokens</th>
              <th style={{ textAlign: "right" }}>Success</th>
              <th style={{ textAlign: "right" }}>Avg dur</th>
            </tr>
          </thead>
          <tbody>
            {data.leaderboard.map((r) => (
              <tr key={r.agentId} style={{ borderTop: "1px solid rgba(127,127,127,.1)" }}>
                <td style={{ padding: "6px 0", fontWeight: 600 }}>{r.name}</td>
                <td style={{ opacity: 0.6 }}>{r.provider ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{r.runs}</td>
                <td style={{ textAlign: "right" }} title={`${r.tokens.toLocaleString()} tokens`}>{formatTokens(r.tokens)}</td>
                <td style={{ textAlign: "right", color: r.successRate >= 0.85 ? COLORS.GREEN : COLORS.AMBER }}>{Math.round(r.successRate * 100)}%</td>
                <td style={{ textAlign: "right" }}>{formatDuration(r.avgDurationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
