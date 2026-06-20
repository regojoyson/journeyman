import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listWorkflowVersions, type WorkflowVersionSummary } from "../api/flows.ts";

interface Props {
  wsId: string;
  workflowId: string;
  onRollback: (versionId: string) => Promise<void>;
  onClose: () => void;
}

export function VersionHistoryPanel({ wsId, workflowId, onRollback, onClose }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const versionsQ = useQuery({
    queryKey: ["flow-versions", workflowId],
    queryFn: () => listWorkflowVersions(wsId, workflowId),
  });

  const versions: WorkflowVersionSummary[] = versionsQ.data ?? [];

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 340, zIndex: 10,
      background: "rgb(var(--color-surface) / 1)", borderLeft: "1px solid rgb(var(--color-border) / 1)",
      display: "flex", flexDirection: "column", padding: 16, overflowY: "auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <strong>Version history</strong>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      {versionsQ.isLoading && <div>Loading…</div>}
      {!versionsQ.isLoading && versions.length === 0 && (
        <div style={{ fontSize: 13, color: "rgb(var(--color-text-muted) / 1)" }}>
          No versions yet. Promote the draft to create the first version.
        </div>
      )}

      {versions.map((v) => (
        <div key={v.id} style={{
          border: "1px solid rgb(var(--color-border) / 1)", borderRadius: 6,
          padding: 10, marginBottom: 8,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>v{v.versionNumber}</span>
            {v.isPublished && (
              <span style={{ fontSize: 11, color: "rgb(var(--color-success) / 1)" }}>live</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}>
            {new Date(v.createdAt).toLocaleString()}
          </div>
          {!v.isPublished && (
            confirmId === v.id ? (
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button type="button" onClick={async () => { await onRollback(v.id); setConfirmId(null); }}>
                  Confirm rollback
                </button>
                <button type="button" onClick={() => setConfirmId(null)}>Cancel</button>
              </div>
            ) : (
              <button type="button" style={{ marginTop: 8 }} onClick={() => setConfirmId(v.id)}>
                Rollback to this
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
