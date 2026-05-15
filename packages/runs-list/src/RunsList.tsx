import "./styles.css";
import React from "react";
import { formatDuration } from "@journeyman/core";
import type { WorkflowInstancesListProps } from "./types.ts";
import { WorkflowInstanceFilters } from "./RunFilters.tsx";
import { ProviderBadge } from "./ProviderBadge.tsx";
import { Pagination } from "./Pagination.tsx";

function rawIssueId(issueRef: string | null | undefined): string {
  if (!issueRef) return "";
  const colon = issueRef.indexOf(":");
  return colon === -1 ? issueRef : issueRef.slice(colon + 1);
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
              <th>Status</th>
              <th>Instance</th>
              <th>Workflow</th>
              <th>Scope</th>
              {scope !== "mine" && <th>Started by</th>}
              <th>Triggered by</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Failed at</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.workflowInstances.map(r => {
              const canAct = r.effectiveRole === "owner";
              const webhookEvent = (r as any).webhookEvent as {
                provider: string; issueRef: string | null; deliveryId: string | null; receivedAt: string;
              } | null | undefined;
              const isIgnored = r.status === "ignored" as string;
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
                    <td><span className={`je-runslist__pill ${r.status}`}>{r.status}</span></td>
                    <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{r.id.slice(0, 8)}</td>
                    <td style={{ color: "#aaa" }}>{r.workflowVersionId ? (p.workflowNameByVersionId?.[r.workflowVersionId] ?? r.workflowVersionId.slice(0, 8)) : r.workflowNameSnapshot}</td>
                    <td><span className={`je-badge je-badge--scope-${r.workflowScopeSnapshot}`}>{r.workflowScopeSnapshot}</span></td>
                    {scope !== "mine" && (
                      <td style={{ color: "#aaa", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                        {r.startedByUserId ? r.startedByUserId.slice(0, 8) : "—"}
                      </td>
                    )}
                    <td>
                      {r.triggerSource === "webhook" && webhookEvent ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <ProviderBadge provider={webhookEvent.provider} />
                          <span style={{ fontSize: 12, color: "#ccc" }}>
                            {rawIssueId(webhookEvent.issueRef)}
                          </span>
                        </span>
                      ) : (
                        <ProviderBadge provider={r.triggerSource} />
                      )}
                    </td>
                    <td style={{ color: "#888" }}>{r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}</td>
                    <td style={{ color: "#888" }}>{formatDuration(r.durationMs)}</td>
                    <td style={{ color: "#ff7675" }}>{r.failedAtNodeId ?? ""}</td>
                    <td onClick={e => e.stopPropagation()}>
                      {canAct && p.onRerun && r.status !== "running" && (
                        <button className="je-runslist__rerun" onClick={() => p.onRerun!(r)}>Re-run</button>
                      )}
                    </td>
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
