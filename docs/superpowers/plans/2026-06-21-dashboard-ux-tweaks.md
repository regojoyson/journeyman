# Dashboard UX Tweaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workspace dashboard scroll, show a minimal native tooltip (label + value) on every chart element, and polish the header/labels — all front-end, no backend changes.

**Architecture:** All changes live in `@journeyman/workspace-dashboard` (`widgets.tsx`, `TrendsBand.tsx`, `AgentsBand.tsx`, `Dashboard.tsx`) plus one wrapper + two props in `@journeyman/web`'s `DashboardPage.tsx`. Tooltips use the browser-native `title` attribute / SVG `<title>` — no library, no state.

**Tech Stack:** React 19, TypeScript (NodeNext ESM), Vitest. Tailwind utility classes for the scroll wrapper (matches sibling pages).

**Spec:** [docs/superpowers/specs/2026-06-21-dashboard-ux-tweaks-design.md](../specs/2026-06-21-dashboard-ux-tweaks-design.md)

> **Execution constraints (per request):** Work on `master`. **No commits** — there are no commit steps. The single verification gate is the final typecheck + unit-test task.

---

## File Structure

- `packages/web/src/routes/DashboardPage.tsx` — **modify**: scroll wrapper + pass `workspaceName` and `lastUpdated`.
- `packages/workspace-dashboard/src/widgets.tsx` — **modify**: `Bars` prop change + tooltips on `Bars`/`Donut`/`HBars`/`Sparkline`.
- `packages/workspace-dashboard/src/TrendsBand.tsx` — **modify**: feed the new `Bars`/`Sparkline` shapes + token-mix tooltip.
- `packages/workspace-dashboard/src/AgentsBand.tsx` — **modify**: new `Bars` shape + leaderboard tokens-cell tooltip.
- `packages/workspace-dashboard/src/Dashboard.tsx` — **modify**: header polish (crumb, live indicator, divider) + band-header accent + new props.
- `packages/workspace-dashboard/src/format.test.ts` — **modify**: add a `formatAgo` test.

No new files.

---

## Task 1: Dashboard scrolls

**Files:**
- Modify: `packages/web/src/routes/DashboardPage.tsx`

The app shell's `<main>` is `overflow: hidden` at fixed `100vh`, so each page owns its scroll. Sibling pages (e.g. `AgentsPage.tsx`) use `<div className="h-full overflow-y-auto">`. The dashboard page lacks it.

- [ ] **Step 1: Wrap the dashboard body in a scroll container**

In `packages/web/src/routes/DashboardPage.tsx`, replace the single outer wrapper:

```tsx
  return (
    <div style={{ padding: 20 }}>
      <Dashboard
        live={live.data ?? null}
        overview={overview.data ?? null}
        window={window}
        onWindowChange={setWindow}
        loading={overview.isLoading}
      />
    </div>
  );
```

with a full-height scroll container wrapping the padded content:

```tsx
  return (
    <div className="h-full overflow-y-auto">
      <div style={{ padding: 20 }}>
        <Dashboard
          live={live.data ?? null}
          overview={overview.data ?? null}
          window={window}
          onWindowChange={setWindow}
          loading={overview.isLoading}
        />
      </div>
    </div>
  );
```

- [ ] **Step 2: Typecheck the package**

Run: `npm run typecheck -w @journeyman/web 2>&1 | grep -v flow-editor | grep "error TS" || echo "no new web errors"`
Expected: `no new web errors` (the pre-existing flow-editor JSX errors are unrelated; this command filters them out).

---

## Task 2: `Bars` — prop change + hover tooltip

**Files:**
- Modify: `packages/workspace-dashboard/src/widgets.tsx`
- Modify: `packages/workspace-dashboard/src/TrendsBand.tsx`
- Modify: `packages/workspace-dashboard/src/AgentsBand.tsx`

`Bars` currently takes `data: number[]` and shows no value on hover. Change it to carry a label+value per bar, render a native `title`, and update both callers.

- [ ] **Step 1: Replace the `Bars` component**

In `packages/workspace-dashboard/src/widgets.tsx`, replace the entire `Bars` function:

```tsx
export function Bars({ data, max }: { data: number[]; max?: number }) {
  const m = max ?? Math.max(1, ...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 90 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1, height: `${(v / m) * 100}%`, minHeight: 2,
          background: `linear-gradient(180deg, ${BLUE}, rgba(106,169,255,.35))`,
          borderRadius: "3px 3px 0 0",
        }} />
      ))}
    </div>
  );
}
```

with:

```tsx
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
```

- [ ] **Step 2: Update the run-volume `Bars` caller in `TrendsBand.tsx`**

In `packages/workspace-dashboard/src/TrendsBand.tsx`, replace:

```tsx
      <Card title="Run volume" cap={`runs per day · ${total} total`}>
        <Bars data={vol.map((d) => d.count)} />
      </Card>
```

with:

```tsx
      <Card title="Run volume" cap={`runs per day · ${total} total`}>
        <Bars bars={vol.map((d) => ({ label: d.day, value: d.count }))} />
      </Card>
```

- [ ] **Step 3: Update the activity `Bars` caller in `AgentsBand.tsx`**

In `packages/workspace-dashboard/src/AgentsBand.tsx`, replace:

```tsx
      <Card title="Activity / day" cap="runs across all agents">
        <Bars data={data.activityPerDay.map((d) => d.count)} />
      </Card>
```

with:

```tsx
      <Card title="Activity / day" cap="runs across all agents">
        <Bars bars={data.activityPerDay.map((d) => ({ label: d.day, value: d.count }))} />
      </Card>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/workspace-dashboard`
Expected: PASS (no errors). If it fails, a `Bars` caller still passes `data=` — fix it.

---

## Task 3: `Donut`, `HBars`, `Sparkline` — hover tooltips

**Files:**
- Modify: `packages/workspace-dashboard/src/widgets.tsx`
- Modify: `packages/workspace-dashboard/src/TrendsBand.tsx`

- [ ] **Step 1: Add a `<title>` to each `Donut` segment**

In `packages/workspace-dashboard/src/widgets.tsx`, inside `Donut`, replace the segment-mapping block:

```tsx
        {segments.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={i} cx="46" cy="46" r="34" fill="none" stroke={s.color} strokeWidth="13"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 46 46)" />
          );
          offset += len;
          return el;
        })}
```

with (adds a `<title>` child so hovering a slice shows its label + value):

```tsx
        {segments.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle key={i} cx="46" cy="46" r="34" fill="none" stroke={s.color} strokeWidth="13"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 46 46)">
              <title>{`${s.label} · ${s.value}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
```

- [ ] **Step 2: Add an optional `title` to `HBars` rows**

In `packages/workspace-dashboard/src/widgets.tsx`, replace the entire `HBars` function:

```tsx
export function HBars({ rows }: {
  rows: { label: string; frac: number; valueText: string; color?: string }[];
}) {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "7px 0" }}>
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
```

with (adds optional `title`, defaulting to `label · valueText`):

```tsx
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
```

- [ ] **Step 3: Replace `Sparkline` to carry per-point titles**

In `packages/workspace-dashboard/src/widgets.tsx`, replace the entire `Sparkline` function:

```tsx
export function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) return <div style={{ height: 90, opacity: 0.4, fontSize: 12 }}>no data</div>;
  const max = Math.max(1, ...points), min = Math.min(...points);
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? 260 / (points.length - 1) : 260;
  const coords = points.map((p, i) => `${i * step},${90 - ((p - min) / span) * 70 - 10}`).join(" ");
  return (
    <svg width="100%" height="90" viewBox="0 0 260 90" preserveAspectRatio="none">
      <polyline fill="none" stroke={BLUE} strokeWidth="2.5" points={coords} />
    </svg>
  );
}
```

with (line from values; an invisible wide hover dot per point carries the `<title>`):

```tsx
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
```

- [ ] **Step 4: Feed `Sparkline` and the token-mix tooltip in `TrendsBand.tsx`**

In `packages/workspace-dashboard/src/TrendsBand.tsx`, replace the duration card's body:

```tsx
        <Sparkline points={data.duration.trend.map((t) => t.medianMs)} />
```

with:

```tsx
        <Sparkline points={data.duration.trend.map((t) => ({
          value: t.medianMs,
          title: `${t.day} · ${formatDuration(t.medianMs)}`,
        }))} />
```

Then, in the same file, replace the token-usage `HBars` (so hovering shows the **full** token count, not the abbreviated one):

```tsx
          <HBars rows={Object.entries(tk.byProvider).map(([label, v]) => ({
            label, frac: v / tkMax, valueText: formatTokens(v),
          }))} />
```

with:

```tsx
          <HBars rows={Object.entries(tk.byProvider).map(([label, v]) => ({
            label, frac: v / tkMax, valueText: formatTokens(v),
            title: `${label} · ${v.toLocaleString()} tokens`,
          }))} />
```

> The trigger-mix and provider-mix `HBars` keep the default tooltip (`label · valueText`, e.g. `webhook · 62%`) — no change needed there.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w @journeyman/workspace-dashboard`
Expected: PASS.

---

## Task 4: Leaderboard tokens-cell tooltip

**Files:**
- Modify: `packages/workspace-dashboard/src/AgentsBand.tsx`

- [ ] **Step 1: Add a `title` to the tokens `<td>`**

In `packages/workspace-dashboard/src/AgentsBand.tsx`, in the leaderboard row, replace:

```tsx
                <td style={{ textAlign: "right" }}>{formatTokens(r.tokens)}</td>
```

with (exact count on hover):

```tsx
                <td style={{ textAlign: "right" }} title={`${r.tokens.toLocaleString()} tokens`}>{formatTokens(r.tokens)}</td>
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/workspace-dashboard`
Expected: PASS.

---

## Task 5: Header & label polish

**Files:**
- Modify: `packages/workspace-dashboard/src/Dashboard.tsx`
- Modify: `packages/web/src/routes/DashboardPage.tsx`
- Modify: `packages/workspace-dashboard/src/format.test.ts`

Add a workspace crumb, a live "updated Xs ago" indicator, a header divider, and an accent bar on each band header. New optional props keep the component usable without the extras.

- [ ] **Step 1: Add a `formatAgo` unit test (TDD for the one bit of logic reused here)**

In `packages/workspace-dashboard/src/format.test.ts`, add at the end of the file:

```tsx
import { formatAgo } from "./format.ts";

describe("formatAgo", () => {
  it("appends ' ago' to a duration", () => expect(formatAgo(40_000)).toBe("40s ago"));
  it("handles minutes", () => expect(formatAgo(221_000)).toBe("3m 41s ago"));
});
```

- [ ] **Step 2: Run the test (it should pass — `formatAgo` already exists)**

Run: `npm test -w @journeyman/workspace-dashboard`
Expected: PASS — `formatAgo` is already implemented in `format.ts`. This pins its behavior before we depend on it in the header.

- [ ] **Step 3: Rewrite `Dashboard.tsx` with the polished header + band accents + new props**

Replace the entire contents of `packages/workspace-dashboard/src/Dashboard.tsx` with:

```tsx
import { useState } from "react";
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
```

- [ ] **Step 4: Pass `workspaceName` + `lastUpdated` from `DashboardPage.tsx`**

In `packages/web/src/routes/DashboardPage.tsx`, add the workspace hook import alongside the existing imports:

```tsx
import { useWorkspace } from "../WorkspaceContext.tsx";
```

Inside the component, after the `useParams` line, read the active workspace:

```tsx
  const { activeWorkspace } = useWorkspace();
```

Then pass the two new props to `<Dashboard>` (extends the JSX from Task 1):

```tsx
        <Dashboard
          live={live.data ?? null}
          overview={overview.data ?? null}
          window={window}
          onWindowChange={setWindow}
          loading={overview.isLoading}
          workspaceName={activeWorkspace?.name}
          lastUpdated={live.dataUpdatedAt}
        />
```

> `live.dataUpdatedAt` is react-query's epoch-ms timestamp of the last successful fetch (the live query refetches every 10s), so the indicator stays current. `activeWorkspace` comes from `WorkspaceContext` (`useWorkspace()`); `?.name` is optional, so a missing workspace simply hides the crumb.

- [ ] **Step 5: Typecheck both packages**

Run: `npm run typecheck -w @journeyman/workspace-dashboard && npm run typecheck -w @journeyman/web 2>&1 | grep -v flow-editor | grep "error TS" || echo "ok: dashboard clean; no new web errors"`
Expected: ends with `ok: dashboard clean; no new web errors`.

> If web reports an error about `activeWorkspace` lacking `name`, inspect `WorkspaceContext`'s `WorkspaceSummary` type and use the correct display field (e.g. `activeWorkspace?.slug`); the crumb just needs a string.

---

## Task 6: Final verification (typecheck + tests gate)

**Files:** none (verification only)

- [ ] **Step 1: Unit tests**

Run: `npm test -w @journeyman/workspace-dashboard`
Expected: PASS — `format.test.ts` now includes `formatTokens` (4), `formatDuration` (2), `formatAgo` (2).

- [ ] **Step 2: Typecheck the changed packages**

Run: `npm run typecheck -w @journeyman/workspace-dashboard`
Expected: PASS (no errors).

- [ ] **Step 3: Typecheck web (no new errors beyond the pre-existing flow-editor baseline)**

Run: `npm run typecheck -w @journeyman/web 2>&1 | grep "error TS" | grep -v flow-editor || echo "no new web errors"`
Expected: `no new web errors`.

- [ ] **Step 4: Import boundaries**

Run: `npm run check:boundaries`
Expected: `✓ Layer boundaries clean across all packages.` (No new cross-package imports were added.)

> **Do not commit.** Leave all changes in the working tree on `master`.

---

## Self-Review Notes

- **Spec coverage:** scroll fix → Task 1; tooltips on Bars/Donut/HBars/Sparkline/leaderboard → Tasks 2–4; header/label polish (crumb, live indicator, divider, band accents) → Task 5. All spec items mapped.
- **Type consistency:** `Bars` becomes `{ bars: { label; value }[] }` (Task 2) and every caller is updated in the same task (TrendsBand, AgentsBand). `Sparkline` becomes `{ points: { value; title }[] }` (Task 3) with its only caller updated in Task 3 Step 4. `HBars` gains optional `title` (back-compatible — existing callers compile unchanged). `Dashboard` gains optional `workspaceName`/`lastUpdated` (back-compatible).
- **Constraint compliance:** no commit steps; single typecheck + test + boundaries gate in Task 6; all on `master`.
