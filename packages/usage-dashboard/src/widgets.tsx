import type { CSSProperties, ReactNode } from "react";

const BLUE = "#6aa9ff", GREEN = "#3ddc84", RED = "#ff6a6a", AMBER = "#ffc24b", PURPLE = "#b18cff";
export const COLORS = { BLUE, GREEN, RED, AMBER, PURPLE };

export function Card({ title, cap, children, span }: {
  title: string; cap?: string; children: ReactNode; span?: boolean;
}) {
  const style: CSSProperties = {
    border: "1px solid rgba(127,127,127,.18)", borderRadius: 12, padding: 14,
    background: "rgba(127,127,127,.04)", gridColumn: span ? "1 / -1" : undefined,
  };
  return (
    <div style={style}>
      <h4 style={{ margin: "0 0 2px", fontSize: 13 }}>{title}</h4>
      {cap && <p style={{ fontSize: 11, opacity: 0.55, margin: "0 0 10px" }}>{cap}</p>}
      {children}
    </div>
  );
}

export function Bars({ bars }: { bars: { label: string; value: number }[] }) {
  const m = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
      {bars.map((b, i) => (
        <div key={i} title={`${b.label} · ${b.value}`} style={{
          flex: 1, height: `${(b.value / m) * 100}%`, minHeight: 2,
          background: `linear-gradient(180deg, ${BLUE}, rgba(106,169,255,.35))`,
          borderRadius: "3px 3px 0 0",
        }} />
      ))}
    </div>
  );
}

export function HBars({ rows }: {
  rows: { label: string; frac: number; valueText: string; color?: string; title?: string }[];
}) {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} title={r.title ?? `${r.label} · ${r.valueText}`}
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "7px 0" }}>
          <span style={{ width: 78, opacity: 0.8 }}>{r.label}</span>
          <span style={{ flex: 1, height: 8, background: "rgba(127,127,127,.15)", borderRadius: 5, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.round(r.frac * 100)}%`, background: r.color ?? BLUE, borderRadius: 5 }} />
          </span>
          <span style={{ width: 48, textAlign: "right", opacity: 0.6, fontSize: 11 }}>{r.valueText}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({ segments }: {
  segments: { value: number; color: string; label: string; valueText?: string }[];
}) {
  if (segments.length === 0) return <div style={{ height: 90, opacity: 0.4, fontSize: 12 }}>no data</div>;
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const C = 2 * Math.PI * 34;
  let offset = 0;
  const display = (s: { value: number; valueText?: string }) => s.valueText ?? String(s.value);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r="34" fill="none" stroke="rgba(127,127,127,.18)" strokeWidth="13" />
        {segments.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={i} cx="46" cy="46" r="34" fill="none" stroke={s.color} strokeWidth="13"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 46 46)">
              <title>{`${s.label} · ${display(s)}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ fontSize: 12 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 0" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
            {s.label} · {display(s)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ points }: { points: { value: number; title: string }[] }) {
  if (points.length === 0) return <div style={{ height: 90, opacity: 0.4, fontSize: 12 }}>no data</div>;
  const values = points.map((p) => p.value);
  const max = Math.max(1, ...values), min = Math.min(...values);
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? 260 / (points.length - 1) : 260;
  const at = (i: number): [number, number] => [i * step, 90 - ((values[i] - min) / span) * 70 - 10];
  const coords = points.map((_, i) => at(i).join(",")).join(" ");
  return (
    <svg width="100%" height="90" viewBox="0 0 260 90" preserveAspectRatio="none">
      <polyline fill="none" stroke={BLUE} strokeWidth="2.5" points={coords} />
      {points.map((p, i) => {
        const [x, y] = at(i);
        return (
          <circle key={i} cx={x} cy={y} r={6} fill="transparent">
            <title>{p.title}</title>
          </circle>
        );
      })}
    </svg>
  );
}
