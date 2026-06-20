import { useState } from "react";
import { X, Check, Circle, RotateCcw } from "lucide-react";
import type { WorkflowVersionSummary } from "@journeyman/core";
import { formatRelativeTime } from "./relative-time.ts";

export interface VersionHistoryPanelProps {
  versions: WorkflowVersionSummary[];
  /** When provided, Restore buttons are shown on non-live rows. */
  onRollback?: (versionId: string) => void | Promise<void>;
  onClose: () => void;
}

export function VersionHistoryPanel({ versions, onRollback, onClose }: VersionHistoryPanelProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const ordered = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);

  const doRollback = async (id: string) => {
    if (!onRollback) return;
    setBusyId(id);
    try {
      await onRollback(id);
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  return (
    <div className="je-history-panel">
      <div className="je-history-panel__header">
        <span className="je-history-panel__title">Version history</span>
        <span className="je-history-panel__count">
          {versions.length} version{versions.length === 1 ? "" : "s"}
        </span>
        <span className="je-history-panel__spacer" />
        <button type="button" className="je-history-panel__close" aria-label="Close version history" onClick={onClose}>
          <X size={15} aria-hidden="true" focusable="false" />
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="je-history-panel__empty">No versions yet. Publish to create the first version.</div>
      ) : (
        <div className="je-history-panel__list">
          {ordered.map((v) => (
            <div key={v.id} className="je-history-row">
              <span className={`je-history-row__marker${v.isPublished ? " is-live" : ""}`}>
                {v.isPublished
                  ? <Check size={14} aria-hidden="true" focusable="false" />
                  : <Circle size={13} aria-hidden="true" focusable="false" />}
              </span>
              <span className="je-history-row__info">
                <span className="je-history-row__line1">
                  <span className="je-history-row__title">Version {v.versionNumber}</span>
                  {v.isPublished && <span className="je-history-row__tag">Live</span>}
                </span>
                <span className="je-history-row__sub">
                  {v.createdByUserId
                    ? `${formatRelativeTime(v.createdAt)} by ${v.createdByUserId}`
                    : formatRelativeTime(v.createdAt)}
                </span>
              </span>
              {onRollback && !v.isPublished && (
                <span className="je-history-row__act">
                  {confirmId === v.id ? (
                    <>
                      <button type="button" className="je-history-btn je-history-btn--primary" disabled={busyId === v.id} onClick={() => doRollback(v.id)}>
                        Confirm restore
                      </button>
                      <button type="button" className="je-history-btn" disabled={busyId === v.id} onClick={() => setConfirmId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="je-history-btn" onClick={() => setConfirmId(v.id)}>
                      <RotateCcw size={13} aria-hidden="true" focusable="false" /> Restore
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
