import { useEffect, useState } from "react";
import type { FlowGraph, PublishError } from "@journeyman/core";
import { validateForPublish } from "@journeyman/core";

interface Props {
  flow: FlowGraph;
  onCancel: () => void;
  onConfirm: () => Promise<{ ok: boolean; serverErrors?: PublishError[] }>;
  onSelectNode: (nodeId: string) => void;
  hasTrigger: boolean;
}

export function PublishModal({ flow, onCancel, onConfirm, onSelectNode, hasTrigger }: Props): JSX.Element {
  const [errors, setErrors] = useState<PublishError[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    const result = validateForPublish(flow, { hasTrigger });
    setErrors(result.ok ? [] : result.errors);
  }, [flow, hasTrigger]);

  const canPublish = errors.length === 0 && !busy;

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    setServerError(null);
    try {
      const res = await onConfirm();
      if (!res.ok) {
        setErrors(res.serverErrors ?? []);
        setServerError("Server rejected publish.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fe-modal-backdrop" onClick={onCancel}>
      <div className="fe-modal" onClick={e => e.stopPropagation()}>
        <h2>Publish flow</h2>
        {errors.length === 0
          ? <p>All checks passed. Ready to publish.</p>
          : (
            <ul className="fe-publish-checklist">
              {errors.map((e, i) => (
                <li key={i} className="fe-publish-fail">
                  <span>✗ {e.message}</span>
                  {e.nodeId
                    ? <button onClick={() => { onSelectNode(e.nodeId!); onCancel(); }}>Show node</button>
                    : null}
                </li>
              ))}
            </ul>
          )}
        {serverError ? <p className="fe-error">{serverError}</p> : null}
        <div className="fe-modal-actions">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={handleConfirm} disabled={!canPublish}>Publish</button>
        </div>
      </div>
    </div>
  );
}
