# Agent Run History Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare, un-paginated Run History tab in the agent editor with a paginated, newest-first table showing status pills, trigger source, relative timestamps, and durations — reusing the existing enriched/paginated backend endpoint.

**Architecture:** Mirror the existing `AgentRunsPage` → `AgentRunsList` split: a thin data-loading wrapper (`RunHistorySection`) fetches via `agentsApi.listRuns(wsId, { agentId, page, pageSize })` and renders a pure, props-driven presentational component (`RunHistoryTable`) that is SSR-testable. Shared `StatusPill` / `fmtRelative` helpers are extracted so the single-agent tab and the workspace-wide list render identically. No backend or `@journeyman/core` changes.

**Tech Stack:** React + TypeScript, Tailwind (web app classes from `routes/admin-styles.ts`), Vitest with `renderToStaticMarkup` (SSR; no jsdom in this package).

---

## Project-specific constraints (per user)

- **Branch:** work on `master` only — do **not** create a feature branch or worktree.
- **No commits:** do not run `git add`/`git commit` at any point. The TDD steps below run tests but never commit.
- **Typecheck at the end only:** run `npm run typecheck` once, as the final task.

## File Structure

- **Create** `packages/web/src/components/agents/shared/run-status.tsx` — exports `StatusPill` and `fmtRelative` (moved out of `AgentRunsList.tsx`). Single responsibility: run-status presentation primitives shared across run views.
- **Modify** `packages/web/src/components/agents/AgentRunsList.tsx` — delete the local `StatusPill` + `fmtRelative` definitions; import them from `./shared/run-status.tsx`.
- **Modify** `packages/web/src/styles.css` — add the missing `@keyframes jePulse` so the running-state dot actually pulses.
- **Create** `packages/web/src/components/agents/sections/RunHistoryTable.tsx` — pure presentational table + pagination footer (props in, callbacks out). SSR-testable.
- **Create** `packages/web/src/components/agents/sections/RunHistoryTable.test.tsx` — SSR tests for the presentational table.
- **Modify** `packages/web/src/components/agents/sections/RunHistorySection.tsx` — full rewrite: data-loading wrapper using `listRuns` + pagination state, rendering `RunHistoryTable`.

No changes to `packages/core`, `packages/api-server`, or the DB.

---

## Task 1: Extract shared run-status helpers

**Files:**
- Create: `packages/web/src/components/agents/shared/run-status.tsx`
- Modify: `packages/web/src/components/agents/AgentRunsList.tsx` (remove local helpers, add import)
- Modify: `packages/web/src/styles.css` (add `@keyframes jePulse`)

- [ ] **Step 1: Create the shared helpers module**

Create `packages/web/src/components/agents/shared/run-status.tsx` with the exact code currently living inside `AgentRunsList.tsx` (the `PILL_STYLE` map, `StatusPill`, and `fmtRelative`), now exported:

```tsx
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
```

- [ ] **Step 2: Update `AgentRunsList.tsx` to import the shared helpers**

In `packages/web/src/components/agents/AgentRunsList.tsx`:

1. Delete the local `PILL_STYLE` constant, the `StatusPill` function, and the `fmtRelative` function (lines defining them — currently `const PILL_STYLE …` through the end of `function fmtRelative …`).
2. Add this import alongside the existing imports near the top:

```tsx
import { StatusPill, fmtRelative } from "./shared/run-status.tsx";
```

3. Leave all call sites (`<StatusPill status={r.status} />`, `fmtRelative(r.startedAt)`) unchanged — the signatures are identical.

Note: `import type { CSSProperties } from "react"` is still used elsewhere in `AgentRunsList.tsx` (e.g. `chipStyle`, `selStyle`), so keep that import.

- [ ] **Step 3: Add the missing `jePulse` keyframe**

In `packages/web/src/styles.css`, append the keyframe (the `StatusPill` running dot references `animation: jePulse …` but no such keyframe is defined anywhere in the repo):

```css
@keyframes jePulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}
```

- [ ] **Step 4: Type-check is deferred to the final task** (per constraints). Do not run typecheck now.

---

## Task 2: Build the presentational `RunHistoryTable` (TDD)

This is the pure, props-driven table. It does no fetching, so it renders fully under `renderToStaticMarkup` and is testable.

**Files:**
- Create: `packages/web/src/components/agents/sections/RunHistoryTable.tsx`
- Test: `packages/web/src/components/agents/sections/RunHistoryTable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/agents/sections/RunHistoryTable.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { AgentRunEnriched } from "../../../api/agents.ts";
import { RunHistoryTable } from "./RunHistoryTable.tsx";

function run(over: Partial<AgentRunEnriched> = {}): AgentRunEnriched {
  return {
    id: "3f9a1c2b-1111-2222-3333-444455556666",
    status: "completed",
    triggerSource: "manual",
    startedAt: "2020-01-01T00:00:00.000Z",
    completedAt: "2020-01-01T00:01:12.000Z",
    durationMs: 72000,
    inputs: {},
    outputs: null,
    agentId: "a1",
    agentName: "triager",
    provider: "claude",
    model: "claude-opus-4-8",
    ...over,
  };
}

function render(props: Partial<Parameters<typeof RunHistoryTable>[0]> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RunHistoryTable
        wsId="w1"
        runs={[run()]}
        total={1}
        page={1}
        pageSize={10}
        loading={false}
        onPageChange={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("RunHistoryTable", () => {
  it("renders status, trigger, relative time, duration, and a run link", () => {
    const html = render();
    expect(html).toContain("completed");
    expect(html).toContain("manual");
    expect(html).toContain("days ago");            // fmtRelative of a 2020 date
    expect(html).toContain("1m 12s");              // formatDuration(72000)
    expect(html).toContain("/workspaces/w1/agent-runs/3f9a1c2b-1111-2222-3333-444455556666");
    expect(html).toContain("3f9a1c2b");            // short id label
  });

  it("shows the loading state", () => {
    expect(render({ loading: true, runs: [] })).toContain("Loading");
  });

  it("shows the empty state when there are no runs", () => {
    expect(render({ runs: [], total: 0 })).toContain("No runs yet.");
  });

  it("shows a live elapsed duration with an ellipsis for running rows", () => {
    const html = render({ runs: [run({ status: "running", durationMs: null })] });
    expect(html).toContain("…");
  });

  it("renders the pagination footer with range and total", () => {
    const html = render({ total: 37, page: 1, pageSize: 10 });
    expect(html).toContain("1–10 of 37");
  });

  it("disables Prev on the first page and enables Next when more pages exist", () => {
    const html = render({ total: 37, page: 1, pageSize: 10 });
    // Prev is disabled (renders the boolean disabled attribute), Next is not.
    expect(html).toMatch(/← Prev[^<]*<\/button>/);
    expect(html).toContain("disabled");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/web -- RunHistoryTable`
Expected: FAIL — `Cannot find module './RunHistoryTable.tsx'` (component not created yet).

- [ ] **Step 3: Implement `RunHistoryTable`**

Create `packages/web/src/components/agents/sections/RunHistoryTable.tsx`:

```tsx
import { Link } from "react-router-dom";
import { formatDuration } from "@journeyman/core";
import type { AgentRunEnriched } from "../../../api/agents.ts";
import { btnSecondary } from "../../../routes/admin-styles.ts";
import { StatusPill, fmtRelative } from "../shared/run-status.tsx";

export interface RunHistoryTableProps {
  wsId: string;
  runs: AgentRunEnriched[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

const TRIGGER_ICON: Record<string, string> = {
  manual: "✋", webhook: "🪝", schedule: "🕑", api: "🔌",
};

function runDuration(r: AgentRunEnriched): string {
  if (r.status === "running") {
    const elapsed = r.startedAt ? Date.now() - new Date(r.startedAt).getTime() : null;
    return `${formatDuration(elapsed)}…`;
  }
  return formatDuration(r.durationMs);
}

export function RunHistoryTable(p: RunHistoryTableProps) {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const from = p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1;
  const to   = Math.min(p.page * p.pageSize, p.total);

  if (p.loading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (p.runs.length === 0) {
    return <div className="text-sm text-muted-foreground">No runs yet.</div>;
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            {["Run", "Status", "Trigger", "Started", "Duration"].map((h) => (
              <th
                key={h}
                className="py-2 px-1.5 text-left text-[11px] uppercase tracking-wide font-medium text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.runs.map((r) => (
            <tr key={r.id} className="border-t hover:bg-accent/50 transition-colors">
              <td className="py-2.5 px-1.5">
                <Link
                  to={`/workspaces/${p.wsId}/agent-runs/${r.id}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {r.id.slice(0, 8)}
                </Link>
              </td>
              <td className="py-2.5 px-1.5"><StatusPill status={r.status} /></td>
              <td className="py-2.5 px-1.5 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true">{TRIGGER_ICON[r.triggerSource] ?? ""}</span>
                  {r.triggerSource}
                </span>
              </td>
              <td className="py-2.5 px-1.5 text-muted-foreground" title={r.startedAt ?? undefined}>
                {fmtRelative(r.startedAt)}
              </td>
              <td className="py-2.5 px-1.5 text-muted-foreground">{runDuration(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {p.total > 0 && (
        <div className="flex items-center justify-end gap-2 mt-4 text-xs text-muted-foreground">
          <span>{from}–{to} of {p.total}</span>
          <button
            type="button"
            className={btnSecondary}
            disabled={p.page <= 1}
            onClick={() => p.onPageChange(p.page - 1)}
          >
            ← Prev
          </button>
          <button
            type="button"
            className={btnSecondary}
            disabled={p.page >= totalPages}
            onClick={() => p.onPageChange(p.page + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
```

Note on trigger icons: emoji are used to stay dependency-free and consistent with the lightweight inline style used elsewhere in this area. If the team prefers `lucide-react` icons (already a dependency — see `SectionShell.tsx`), that is a drop-in later change; emoji keep this task self-contained.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/web -- RunHistoryTable`
Expected: PASS (all 6 tests green).

---

## Task 3: Rewrite `RunHistorySection` as a data-loading wrapper

**Files:**
- Modify: `packages/web/src/components/agents/sections/RunHistorySection.tsx` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/web/src/components/agents/sections/RunHistorySection.tsx` with:

```tsx
import { useCallback, useEffect, useState } from "react";
import { agentsApi, type AgentRunsPage } from "../../../api/agents.ts";
import { SectionShell } from "./SectionShell.tsx";
import { RunHistoryTable } from "./RunHistoryTable.tsx";

const PAGE_SIZE = 10;

export function RunHistorySection({ wsId, agentId }: { wsId: string; agentId: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AgentRunsPage | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await agentsApi.listRuns(wsId, { agentId, page, pageSize: PAGE_SIZE });
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [wsId, agentId, page]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  return (
    <SectionShell title="Run history" description="Past executions of this agent, newest first.">
      <RunHistoryTable
        wsId={wsId}
        runs={result?.runs ?? []}
        total={result?.total ?? 0}
        page={result?.page ?? page}
        pageSize={result?.pageSize ?? PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />
    </SectionShell>
  );
}
```

Rationale for the changes:
- Drops the old `agentsApi.runs()` call (un-paginated, bare fields) in favour of `agentsApi.listRuns({ agentId, page, pageSize })`, which the API client already exposes and which hits `GET /api/workspaces/:wsId/agent-runs?agentId=…`, ordered newest-first.
- Pagination state lives here; the presentational `RunHistoryTable` is dumb.
- `description` now reads "Past executions of this agent, newest first." (previously "Past executions of this agent.").

- [ ] **Step 2: Confirm no other code depends on the old `runs()` return shape here**

The old section was the only consumer of `agentsApi.runs` in the UI for this view. Leave `agentsApi.runs` and the `/agents/:id/runs` GET endpoint in place (no removal in scope) — only this component stops using it.

Run: `git grep -n "agentsApi.runs(" packages/web/src`
Expected: no remaining references inside `RunHistorySection.tsx` (any other hits, if present, are unrelated and out of scope).

---

## Task 4: Final verification (typecheck + tests)

**Files:** none (verification only)

- [ ] **Step 1: Run the web package tests**

Run: `npm test --workspace @journeyman/web`
Expected: PASS, including the new `RunHistoryTable` tests and the existing `RunAgentModal` / `agent-form` tests (no regressions).

- [ ] **Step 2: Run the type-check (whole repo, per constraints — typecheck at end only)**

Run: `npm run typecheck`
Expected: PASS with no errors. Pay particular attention to `packages/web` — the new `RunHistoryTable.tsx`, `shared/run-status.tsx`, and the rewritten `RunHistorySection.tsx`.

- [ ] **Step 3: Do NOT commit**

Per the user's constraints, leave all changes uncommitted in the working tree on `master`. Report the changed/created files and the typecheck + test results.

---

## Self-Review notes

- **Spec coverage:** data-source switch (Task 3) ✓; shared `StatusPill`/`fmtRelative` extraction + `jePulse` fix (Task 1) ✓; rebuilt Tailwind table with Run/Status/Trigger/Started/Duration (Task 2) ✓; pagination footer (Task 2) ✓; tests (Task 2) ✓; newest-first ordering (inherited from the endpoint's `ORDER BY started_at DESC`, surfaced in the section description) ✓.
- **Out of scope honoured:** no filters, no re-run button, no agent/model columns.
- **Type consistency:** `RunHistoryTableProps` defined in Task 2 is consumed verbatim in Task 3; `AgentRunsPage`/`AgentRunEnriched` types come from `../../../api/agents.ts`; `formatDuration` from `@journeyman/core`; `btnSecondary` from `routes/admin-styles.ts`.
- **Testability:** presentation split from fetching so the table renders under `renderToStaticMarkup` (no jsdom in `@journeyman/web`); the fetching wrapper's effect is intentionally not unit-tested (matches the untested `AgentRunsPage` pattern).
