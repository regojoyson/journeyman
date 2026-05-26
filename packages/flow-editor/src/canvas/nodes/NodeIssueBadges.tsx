import { AlertCircle, AlertTriangle } from "lucide-react";
import { useNodeIssues } from "../../state/validation-context.tsx";

/**
 * Renders 0–2 small pill badges in the top-left corner of a node showing
 * validation errors (red) and warnings (amber). Tooltip lists messages.
 * Errors pulse subtly to draw the eye.
 */
export function NodeIssueBadges({ nodeId }: { nodeId: string }) {
  const { errors, warnings } = useNodeIssues(nodeId);
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <>
      {errors.length > 0 && (
        <span
          className="je-node-issue-badge je-node-issue-badge--error"
          aria-label={`${errors.length} error${errors.length > 1 ? "s" : ""}`}
          title={errors.map(e => e.message).join("\n\n")}
        >
          <AlertCircle size={12} strokeWidth={2.5} aria-hidden />
          {errors.length > 1 && <span className="je-node-issue-badge__count">{errors.length}</span>}
        </span>
      )}
      {warnings.length > 0 && (
        <span
          className="je-node-issue-badge je-node-issue-badge--warning"
          aria-label={`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`}
          title={warnings.map(w => w.message).join("\n\n")}
        >
          <AlertTriangle size={12} strokeWidth={2.5} aria-hidden />
          {warnings.length > 1 && <span className="je-node-issue-badge__count">{warnings.length}</span>}
        </span>
      )}
    </>
  );
}
