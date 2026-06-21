import type { OverviewStats } from "@journeyman/core";
import { Card, Bars, HBars, Donut, Sparkline, COLORS } from "./widgets.tsx";
import { formatTokens, formatDuration } from "./format.ts";

export function TrendsBand({ data }: { data: OverviewStats }) {
  const vol = data.runVolume;
  const total = vol.reduce((s, d) => s + d.count, 0);
  const o = data.outcomeSplit;
  const tk = data.tokens;
  const tkMax = Math.max(1, ...Object.values(tk.byProvider));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      <Card title="Run volume" cap={`runs per day · ${total} total`}>
        <Bars bars={vol.map((d) => ({ label: d.day, value: d.count }))} />
      </Card>

      <Card title="Success vs failure" cap={`${Math.round(o.successRate * 100)}% success rate`}>
        <Donut segments={[
          { value: o.completed, color: COLORS.GREEN, label: "Completed" },
          { value: o.failed, color: COLORS.RED, label: "Failed" },
          { value: o.cancelled, color: "rgba(127,127,127,.4)", label: "Cancelled" },
        ]} />
      </Card>

      <Card title="Avg run duration" cap={`median ${formatDuration(data.duration.medianMs)} · ${data.duration.deltaPct <= 0 ? "↓" : "↑"} ${Math.abs(Math.round(data.duration.deltaPct * 100))}%`}>
        <Sparkline points={data.duration.trend.map((t) => ({
          value: t.medianMs,
          title: `${t.day} · ${formatDuration(t.medianMs)}`,
        }))} />
      </Card>

      <Card title="Runs by trigger" cap="how work enters">
        <HBars rows={Object.entries(data.byTrigger).map(([label, frac]) => ({
          label, frac, valueText: `${Math.round(frac * 100)}%`,
        }))} />
      </Card>

      <Card title="Token usage" cap={`${formatTokens(tk.total)} tokens · $ later`}>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{formatTokens(tk.total)}</div>
        <div style={{ marginTop: 12 }}>
          <HBars rows={Object.entries(tk.byProvider).map(([label, v]) => ({
            label, frac: v / tkMax, valueText: formatTokens(v),
            title: `${label} · ${v.toLocaleString()} tokens`,
          }))} />
        </div>
      </Card>

      <Card title="Top failure points" cap="where runs break">
        {data.topFailures.length === 0 && <p style={{ fontSize: 12, opacity: 0.5 }}>No failures</p>}
        {data.topFailures.map((f, i) => (
          <div key={i} style={{ display: "flex", padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(127,127,127,.1)" }}>
            <span>{f.nodeId ?? "unknown"}</span>
            <span style={{ marginLeft: "auto", color: COLORS.RED, fontWeight: 600 }}>{f.count}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
