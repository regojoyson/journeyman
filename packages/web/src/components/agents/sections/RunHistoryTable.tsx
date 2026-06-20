import { Link } from "react-router-dom";
import { formatDuration } from "@journeyman/core";
import { refLabel } from "@journeyman/runs-list";
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

/** Drop agentId — redundant in the single-agent run history view. */
function runRef(inputs: Record<string, unknown>) {
  const { agentId: _agentId, ...rest } = inputs;
  return refLabel(rest);
}

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
            {["Input", "Status", "Trigger", "Started", "Duration"].map((h) => (
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
          {p.runs.map((r) => {
            const ref = runRef(r.inputs);
            return (
            <tr key={r.id} className="border-t hover:bg-accent/50 transition-colors">
              <td className="py-2.5 px-1.5" title={ref?.full}>
                <Link
                  to={`/workspaces/${p.wsId}/agent-runs/${r.id}`}
                  className="hover:underline"
                >
                  {ref ? (
                    <>
                      <div className="text-[10px] uppercase tracking-wide font-mono text-muted-foreground">
                        {ref.keyLabel}
                      </div>
                      <div className="text-xs font-mono text-primary truncate max-w-[220px]">
                        {ref.valueText}
                      </div>
                    </>
                  ) : (
                    <span className="font-mono text-xs text-primary">{r.id.slice(0, 8)}</span>
                  )}
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
            );
          })}
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
