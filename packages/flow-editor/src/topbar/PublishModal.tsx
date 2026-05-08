import { useEffect, useMemo, useState } from "react";
import type { WorkflowGraph, PublishError, PhaseConfigValidator } from "@journeyman/core";
import { validateForPublish } from "@journeyman/core";
import { usePhaseRegistry } from "../state/phase-registry-context.tsx";

interface Props {
  flow: WorkflowGraph;
  onCancel: () => void;
  onConfirm: () => Promise<{ ok: boolean; serverErrors?: PublishError[]; warnings?: PublishError[] }>;
  onSelectNode: (nodeId: string) => void;
  hasTrigger: boolean;
}

function isHardError(e: PublishError): boolean {
  return !e.severity || e.severity === "error";
}

export function PublishModal({ flow, onCancel, onConfirm, onSelectNode, hasTrigger }: Props): JSX.Element {
  const [issues, setIssues] = useState<PublishError[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const registry = usePhaseRegistry();
  const phaseConfigValidators = useMemo<Map<string, PhaseConfigValidator>>(() => {
    const map = new Map<string, PhaseConfigValidator>();
    for (const def of registry.list()) {
      const schema = def.configSchema as
        | { safeParse: (v: unknown) => { success: boolean; error?: { issues?: Array<{ path?: (string | number)[]; message?: string }> } } }
        | undefined;
      if (!schema) continue;
      map.set(def.phaseType, (config: unknown) => {
        const r = schema.safeParse(config);
        if (r.success) return [];
        return (r.error?.issues ?? []).map(i => ({
          path: i.path ?? [],
          message: i.message ?? "Invalid value",
        }));
      });
    }
    return map;
  }, [registry]);

  useEffect(() => {
    const result = validateForPublish(flow, { hasTrigger, phaseConfigValidators });
    setIssues(result.errors);
  }, [flow, hasTrigger, phaseConfigValidators]);

  const hardErrors = issues.filter(isHardError);
  const warnings = issues.filter(e => e.severity === "warning");
  const canPublish = hardErrors.length === 0 && !busy && !published;

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    setServerError(null);
    try {
      const res = await onConfirm();
      if (res.ok) {
        setPublished(true);
        if (res.warnings?.length) setIssues(res.warnings);
        else setIssues([]);
      } else {
        setIssues(res.serverErrors ?? []);
        setServerError("Server rejected publish.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fe-modal-backdrop" onClick={published ? undefined : onCancel}>
      <div className="fe-modal" onClick={e => e.stopPropagation()}>
        <h2>Publish flow</h2>

        {published ? (
          <>
            <p style={{ color: "#55efc4" }}>✓ Published successfully.</p>
            {issues.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
                  The following may affect runtime behaviour:
                </p>
                <ul className="fe-publish-checklist">
                  {issues.map((e, i) => (
                    <li key={i} className="fe-publish-warn">
                      <span>⚠ {e.message}</span>
                      {e.nodeId
                        ? <button onClick={() => { onSelectNode(e.nodeId!); onCancel(); }}>Show node</button>
                        : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="fe-modal-actions">
              <button onClick={onCancel}>Close</button>
            </div>
          </>
        ) : (
          <>
            {hardErrors.length === 0 && warnings.length === 0
              ? <p>All checks passed. Ready to publish.</p>
              : (
                <ul className="fe-publish-checklist">
                  {hardErrors.map((e, i) => (
                    <li key={`e-${i}`} className="fe-publish-fail">
                      <span>✗ {e.message}</span>
                      {e.nodeId
                        ? <button onClick={() => { onSelectNode(e.nodeId!); onCancel(); }}>Show node</button>
                        : null}
                    </li>
                  ))}
                  {warnings.map((e, i) => (
                    <li key={`w-${i}`} className="fe-publish-warn">
                      <span>⚠ {e.message}</span>
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
          </>
        )}
      </div>
    </div>
  );
}
