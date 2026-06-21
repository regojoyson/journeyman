import type { CSSProperties } from "react";
import type { AnalyticsWindow, LiveStats, OverviewStats } from "@journeyman/core";
import { LiveBand } from "./LiveBand.tsx";
import { TrendsBand } from "./TrendsBand.tsx";
import { AgentsBand } from "./AgentsBand.tsx";
import { formatAgo } from "./format.ts";

export interface DashboardProps {
  live: LiveStats | null;
  overview: OverviewStats | null;
  window: AnalyticsWindow;
  onWindowChange: (w: AnalyticsWindow) => void;
  loading?: boolean;
  /** Workspace display name, shown as a crumb above the title. */
  workspaceName?: string;
  /** Epoch ms of the last live refresh; drives the "updated Xs ago" pulse. */
  lastUpdated?: number;
}

const WINDOWS: AnalyticsWindow[] = ["24h", "7d", "30d"];

const bandHdr: CSSProperties = {
  fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase",
  opacity: 0.55, fontWeight: 700, margin: "22px 0 10px",
  borderLeft: "3px solid #6aa9ff", paddingLeft: 8,
};

export function Dashboard({
  live, overview, window, onWindowChange, loading, workspaceName, lastUpdated,
}: DashboardProps) {
  return (
    <div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        flexWrap: "wrap", gap: 12,
        borderBottom: "1px solid rgba(127,127,127,.15)", paddingBottom: 10,
      }}>
        <div>
          {workspaceName && (
            <div style={{ fontSize: 12, opacity: 0.55 }}>{workspaceName} ▸</div>
          )}
          <h2 style={{ margin: "2px 0 0" }}>Dashboard</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {lastUpdated != null && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.75 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3ddc84" }} />
              updated {formatAgo(Math.max(0, Date.now() - lastUpdated))}
            </span>
          )}
          <div style={{ display: "inline-flex", border: "1px solid rgba(127,127,127,.3)", borderRadius: 8, overflow: "hidden" }}>
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => onWindowChange(w)} style={{
                padding: "5px 11px", border: "none", cursor: "pointer",
                background: w === window ? "#6aa9ff" : "transparent",
                color: w === window ? "#031227" : "inherit", fontWeight: w === window ? 600 : 400,
              }}>{w}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={bandHdr}>⚡ Live now</div>
      {live ? <LiveBand data={live} /> : <p style={{ opacity: 0.5 }}>Loading…</p>}

      <div style={bandHdr}>📈 Trends · last {window}</div>
      {overview ? <TrendsBand data={overview} /> : <p style={{ opacity: 0.5 }}>{loading ? "Loading…" : "No data"}</p>}

      <div style={bandHdr}>🤖 Agents</div>
      {overview ? <AgentsBand data={overview.agents} /> : <p style={{ opacity: 0.5 }}>{loading ? "Loading…" : "No data"}</p>}
    </div>
  );
}
