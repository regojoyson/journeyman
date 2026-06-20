import type { CSSProperties } from "react";

const PILL_STYLE: Record<string, CSSProperties> = {
  running:   { background: "rgba(74,158,255,.15)",  color: "#4a9eff" },
  completed: { background: "rgba(16,185,129,.15)",  color: "#10b981" },
  failed:    { background: "rgba(239,68,68,.15)",   color: "#ef4444" },
  cancelled: { background: "rgba(161,161,170,.15)", color: "#a1a1aa" },
  paused:    { background: "rgba(253,203,110,.15)", color: "#fbbf24" },
};

export function StatusPill({ status }: { status: string }) {
  const style = PILL_STYLE[status] ?? PILL_STYLE.cancelled;
  return (
    <span style={{
      ...style,
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, padding: "2px 8px", borderRadius: 8, fontWeight: 600,
      textTransform: "uppercase",
    }}>
      {status === "running" && (
        <span style={{
          width: 5, height: 5, borderRadius: "50%",
          background: "#4a9eff", flexShrink: 0,
          animation: "jePulse 1.4s infinite",
        }} />
      )}
      {status}
    </span>
  );
}

export function fmtRelative(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return "just now";
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
