import { useEffect, useMemo, useState, type JSX } from "react";
import type { WorkflowGraph, PublishError, StepConfigValidator } from "@journeyman/core";
import { validateForPublish } from "@journeyman/core";
import { useStepRegistry } from "../state/step-registry-context.tsx";
import { IssueMessage } from "../issues/IssueMessage.tsx";

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

function IssueRow({
  kind,
  issue,
  flow,
  onSelectNode,
  onCancel,
}: {
  kind: "error" | "warning";
  issue: PublishError;
  flow: WorkflowGraph;
  onSelectNode: (nodeId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const icon = kind === "error" ? "✗" : "⚠";
  const className = kind === "error" ? "fe-publish-fail" : "fe-publish-warn";
  const chipLabel = issue.nodeLabel ?? "Flow";
  const clickable = Boolean(issue.nodeId);
  return (
    <li className={className}>
      <span className="fe-publish-row">
        <span className="fe-publish-icon">{icon}</span>
        <button
          type="button"
          className="fe-publish-chip"
          disabled={!clickable}
          onClick={() => {
            if (issue.nodeId) {
              onSelectNode(issue.nodeId);
              onCancel();
            }
          }}
        >
          {chipLabel}
        </button>
        <span className="fe-publish-message">
          <IssueMessage
            flow={flow}
            message={issue.message}
            onSelectNode={onSelectNode}
            onAfterClick={onCancel}
          />
          {issue.detail ? (
            <span className="je-diagnostic__why">
              <span className="je-diagnostic__label">Why:</span>{" "}
              <IssueMessage flow={flow} message={issue.detail} onSelectNode={onSelectNode} onAfterClick={onCancel} />
            </span>
          ) : null}
          {issue.fixes && issue.fixes.length > 0 ? (
            <span className="je-diagnostic__fixes">
              <span className="je-diagnostic__label">Fixes:</span>
              {issue.fixes.map((f, i) => (
                <span className="je-diagnostic__fix" key={i}>
                  <IssueMessage flow={flow} message={f} onSelectNode={onSelectNode} onAfterClick={onCancel} />
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </span>
    </li>
  );
}

export function PublishModal({ flow, onCancel, onConfirm, onSelectNode, hasTrigger }: Props): JSX.Element {
  const [issues, setIssues] = useState<PublishError[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const registry = useStepRegistry();
  const stepConfigValidators = useMemo<Map<string, StepConfigValidator>>(() => {
    const map = new Map<string, StepConfigValidator>();
    for (const def of registry.list()) {
      const schema = def.configSchema as
        | { safeParse: (v: unknown) => { success: boolean; error?: { issues?: Array<{ path?: (string | number)[]; message?: string }> } } }
        | undefined;
      if (!schema) continue;
      map.set(def.stepType, (config: unknown) => {
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
    const result = validateForPublish(flow, { hasTrigger, stepConfigValidators });
    setIssues(result.errors);
  }, [flow, hasTrigger, stepConfigValidators]);

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
            <p style={{ color: "rgb(var(--color-success) / 1)" }}>✓ Published successfully.</p>
            {issues.length > 0 && (
              <>
                <p style={{ fontSize: 12, color: "rgb(var(--color-text-muted) / 1)", marginBottom: 6 }}>
                  The following may affect runtime behaviour:
                </p>
                <ul className="fe-publish-checklist">
                  {issues.map((e, i) => (
                    <IssueRow key={i} kind="warning" issue={e} flow={flow} onSelectNode={onSelectNode} onCancel={onCancel} />
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
                <>
                  {hardErrors.length > 0 && (
                    <section className="fe-publish-section">
                      <h3 className="fe-publish-section-heading fe-publish-section-heading--error">
                        Errors ({hardErrors.length})
                        <span className="fe-publish-section-subline">must fix before publish</span>
                      </h3>
                      <ul className="fe-publish-checklist">
                        {hardErrors.map((e, i) => (
                          <IssueRow key={`e-${i}`} kind="error" issue={e} flow={flow} onSelectNode={onSelectNode} onCancel={onCancel} />
                        ))}
                      </ul>
                    </section>
                  )}
                  {warnings.length > 0 && (
                    <section className="fe-publish-section">
                      <h3 className="fe-publish-section-heading fe-publish-section-heading--warn">
                        Warnings ({warnings.length})
                        <span className="fe-publish-section-subline">publish allowed; review before running</span>
                      </h3>
                      <ul className="fe-publish-checklist">
                        {warnings.map((e, i) => (
                          <IssueRow key={`w-${i}`} kind="warning" issue={e} flow={flow} onSelectNode={onSelectNode} onCancel={onCancel} />
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              )}
            {serverError ? <p className="fe-error">{serverError}</p> : null}
            <div className="fe-modal-actions">
              <button onClick={onCancel} disabled={busy}>Cancel</button>
              <button onClick={handleConfirm} disabled={!canPublish} className="fe-btn-primary">Publish</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
