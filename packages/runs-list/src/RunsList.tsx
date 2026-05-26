import "./styles.css";
import React from "react";
import { formatDuration } from "@journeyman/core";
import type { WorkflowInstancesListProps } from "./types.ts";
import { WorkflowInstanceFilters } from "./RunFilters.tsx";
import { ProviderBadge } from "./ProviderBadge.tsx";
import { Pagination } from "./Pagination.tsx";

/**
 * Render the workflow inputs as a short "key=value, key=value" summary for the
 * leftmost column. Non-primitive values are skipped. Full pairs go in the
 * tooltip; the visible string is truncated.
 */
function refLabel(inputs: Record<string, unknown> | undefined): { text: string; title?: string } {
  if (!inputs) return { text: "—" };
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      pairs.push(`${k}=${String(v)}`);
    }
  }
  if (pairs.length === 0) return { text: "—" };
  const full = pairs.join(", ");
  const text = full.length > 60 ? full.slice(0, 57) + "…" : full;
  return { text, title: full };
}

export function WorkflowInstancesList(p: WorkflowInstancesListProps) {
  const scope = p.scope ?? "mine";
  const [expandedIgnored, setExpandedIgnored] = React.useState<Set<string>>(new Set());
  return (
    <div className="je-runslist">
      <div className="je-runslist__header">
        <h2>Workflow Instances</h2>
        {p.onScopeChange && (
          <div className="je-runslist__scope-chips" style={{ display: "flex", gap: 6, marginLeft: 12 }}>
            <button
              type="button"
              className={`je-chip ${scope === "mine" ? "je-chip--active" : ""}`}
              onClick={() => p.onScopeChange!("mine")}
            >Mine</button>
            {p.showOrgChip && (
              <button
                type="button"
                className={`je-chip ${scope === "org" ? "je-chip--active" : ""}`}
                onClick={() => p.onScopeChange!("org")}
              >Organization</button>
            )}
            {p.showAllChip && (
              <button
                type="button"
                className={`je-chip ${scope === "all" ? "je-chip--active" : ""}`}
                onClick={() => p.onScopeChange!("all")}
              >All</button>
            )}
          </div>
        )}
        <div style={{ flex: 1 }} />
        {p.onNewWorkflowInstance && (
          <button
            type="button"
            className="je-runslist__new-run"
            onClick={p.onNewWorkflowInstance}
          >+ New Workflow Instance</button>
        )}
        <WorkflowInstanceFilters filter={p.filter} onChange={p.onFilterChange} />
      </div>
      {p.isLoading && <div style={{ color: "#888" }}>Loading…</div>}
      {!p.isLoading && p.workflowInstances.length === 0 && (
        <div style={{ color: "#888" }}>No workflow instances match the current filters.</div>
      )}
      {p.workflowInstances.length > 0 && (
        <table className="je-runslist__table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Status</th>
              <th>Instance</th>
              <th>Workflow</th>
              <th>Scope</th>
              {scope !== "mine" && <th>Started by</th>}
              <th>Triggered by</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Failed at</th>
            </tr>
          </thead>
          <tbody>
            {p.workflowInstances.map(r => {
              const webhookEvent = (r as any).webhookEvent as {
                provider: string; deliveryId: string | null; receivedAt: string;
              } | null | undefined;
              const isIgnored = r.status === "ignored" as string;
              const ref = refLabel(r.inputs);
              return (
                <React.Fragment key={r.id}>
                  <tr
                    style={isIgnored ? { opacity: 0.45, cursor: "pointer" } : undefined}
                    onClick={isIgnored
                      ? () => setExpandedIgnored(prev => {
                          const next = new Set(prev);
                          next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                          return next;
                        })
                      : () => p.onSelectWorkflowInstance(r.id)}
                  >
                    <td
                      title={ref.title}
                      style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#cfd6e4", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {ref.text}
                    </td>
                    <td><span className={`je-runslist__pill ${r.status}`}>{r.status}</span></td>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{r.id.slice(0, 8)}</td>
                    <td style={{ color: "#aaa" }}>
                      {(r.workflowVersionId && p.workflowNameByVersionId?.[r.workflowVersionId])
                        || r.workflowNameSnapshot
                        || (r.workflowVersionId ? r.workflowVersionId.slice(0, 8) : "—")}
                    </td>
                    <td><span className={`je-badge je-badge--scope-${r.workflowScopeSnapshot}`}>{r.workflowScopeSnapshot}</span></td>
                    {scope !== "mine" && (
                      <td style={{ color: "#aaa", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                        {r.startedByUserId ? r.startedByUserId.slice(0, 8) : "—"}
                      </td>
                    )}
                    <td>
                      {r.triggerSource === "webhook" && webhookEvent ? (
                        <ProviderBadge provider={webhookEvent.provider} />
                      ) : (
                        <ProviderBadge provider={r.triggerSource} />
                      )}
                    </td>
                    <td style={{ color: "#888" }}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                    <td style={{ color: "#888" }}>{formatDuration(r.durationMs)}</td>
                    <td style={{ color: "#ff7675" }}>{r.failedAtNodeId ?? ""}</td>
                  </tr>
                  {isIgnored && expandedIgnored.has(r.id) && (
                    <tr>
                      <td colSpan={99} style={{ background: "#1a1a2e", padding: "8px 16px", color: "#fbbf24", fontSize: 12 }}>
                        ⚠ Webhook ignored — no matching workflow found
                        {webhookEvent?.deliveryId && (
                          <span style={{ marginLeft: 12, color: "#888" }}>
                            Delivery: {webhookEvent.deliveryId}
                          </span>
                        )}
                        {webhookEvent?.receivedAt && (
                          <span style={{ marginLeft: 12, color: "#888" }}>
                            Received: {new Date(webhookEvent.receivedAt).toUTCString()}
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {p.pagination && (
        <Pagination
          page={p.pagination.page}
          pageSize={p.pagination.pageSize}
          total={p.pagination.total}
          onPageChange={p.pagination.onPageChange}
          onPageSizeChange={p.pagination.onPageSizeChange}
        />
      )}
    </div>
  );
}
