import type { LiveStats } from "@journeyman/core";
import { Card, Kpi, COLORS } from "./widgets.tsx";
import { formatDuration } from "./format.ts";

const dotColor: Record<string, string> = {
  running: COLORS.BLUE, completed: COLORS.GREEN, failed: COLORS.RED,
  paused: COLORS.AMBER, pending: COLORS.AMBER, provisioning: COLORS.AMBER, cancelled: "rgba(127,127,127,.5)",
};

export function LiveBand({ data }: { data: LiveStats }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      <Card title="Active runs" cap="happening right now">
        <Kpi value={data.activeRuns.total} sub={[
          { n: data.activeRuns.running, label: "running", color: COLORS.GREEN },
          { n: data.activeRuns.queued, label: "queued" },
          { n: data.activeRuns.paused, label: "paused", color: COLORS.AMBER },
        ]} />
      </Card>

      <Card title="Needs attention" cap="paused or failed < 1h">
        {data.needsAttention.length === 0 && <p style={{ fontSize: 12, opacity: 0.5 }}>All clear</p>}
        {data.needsAttention.slice(0, 4).map((a) => (
          <div key={a.instanceId} style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(127,127,127,.1)" }}>
            <span style={{ color: a.state === "failed" ? COLORS.RED : COLORS.AMBER }}>{a.state === "failed" ? "✕" : "⏸"}</span>
            <div><b>{a.name}</b><div style={{ opacity: 0.6 }}>{a.nodeId ?? a.state} · {formatDuration(a.ageMs)}</div></div>
          </div>
        ))}
      </Card>

      <Card title="Live run feed" cap="latest activity">
        {data.recentFeed.map((f) => (
          <div key={f.instanceId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12, borderBottom: "1px solid rgba(127,127,127,.1)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor[f.status] ?? COLORS.BLUE }} />
            <span style={{ fontWeight: 600 }}>{f.name}</span>
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(127,127,127,.15)" }}>{f.trigger}</span>
            <span style={{ marginLeft: "auto", opacity: 0.55, fontSize: 11 }}>{f.status} · {formatDuration(f.elapsedMs)}</span>
          </div>
        ))}
      </Card>

      <Card title="Sandboxes up" cap="provisioned environments">
        <Kpi value={data.activeSandboxes.total}
          sub={Object.entries(data.activeSandboxes.byType).map(([k, v]) => ({ n: v, label: k }))} />
      </Card>
    </div>
  );
}
