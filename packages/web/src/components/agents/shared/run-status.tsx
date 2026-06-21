import type { CSSProperties } from "react";

const PILL_STYLE: Record<string, CSSProperties> = {
  running:   { background: "rgb(var(--color-info) / .15)",        color: "rgb(var(--color-info))" },
  completed: { background: "rgb(var(--color-success) / .15)",     color: "rgb(var(--color-success))" },
  failed:    { background: "rgb(var(--color-danger) / .15)",      color: "rgb(var(--color-danger))" },
  cancelled: { background: "rgb(var(--color-text-subtle) / .15)", color: "rgb(var(--color-text-subtle))" },
  paused:    { background: "rgb(var(--color-warning) / .15)",     color: "rgb(var(--color-warning))" },
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
          background: "rgb(var(--color-info))", flexShrink: 0,
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
