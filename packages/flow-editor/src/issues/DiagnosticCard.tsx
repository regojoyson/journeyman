import type { ReactElement } from "react";
import type { WorkflowGraph, PublishError } from "@journeyman/core";
import { IssueMessage } from "./IssueMessage.tsx";

interface Props {
  flow: WorkflowGraph;
  diagnostic: PublishError;
  onSelectNode: (id: string) => void;
  onAfterClick?: () => void;
}

/**
 * Renders a structured validation diagnostic as a compiler-style card:
 *   [code]  Node label
 *   <summary>
 *   Why: <detail>
 *   Fixes:
 *     • <fix>
 * Node-id substrings in any text are linkified via IssueMessage (jump-to-node).
 */
export function DiagnosticCard({ flow, diagnostic, onSelectNode, onAfterClick }: Props): ReactElement {
  const tone = (diagnostic.severity ?? "error") === "warning" ? "warn" : "error";
  const icon = tone === "warn" ? "⚠" : "✕";
  return (
    <div className={`je-diagnostic je-diagnostic--${tone}`}>
      <div className="je-diagnostic__head">
        <span className="je-diagnostic__icon" aria-hidden>{icon}</span>
        <code className="je-diagnostic__code">{diagnostic.code}</code>
        {diagnostic.nodeId ? (
          <button
            type="button"
            className="je-issue-link je-diagnostic__node"
            onClick={() => { onSelectNode(diagnostic.nodeId!); onAfterClick?.(); }}
          >
            {diagnostic.nodeLabel ?? diagnostic.nodeId}
          </button>
        ) : diagnostic.nodeLabel ? (
          <span className="je-diagnostic__node">{diagnostic.nodeLabel}</span>
        ) : null}
      </div>

      <div className="je-diagnostic__summary">
        <IssueMessage flow={flow} message={diagnostic.message} onSelectNode={onSelectNode} onAfterClick={onAfterClick} />
      </div>

      {diagnostic.detail ? (
        <div className="je-diagnostic__why">
          <span className="je-diagnostic__label">Why:</span>{" "}
          <IssueMessage flow={flow} message={diagnostic.detail} onSelectNode={onSelectNode} onAfterClick={onAfterClick} />
        </div>
      ) : null}

      {diagnostic.fixes && diagnostic.fixes.length > 0 ? (
        <div className="je-diagnostic__fixes">
          <span className="je-diagnostic__label">Fixes:</span>
          <ul className="je-diagnostic__fix-list">
            {diagnostic.fixes.map((f, i) => (
              <li key={i}>
                <IssueMessage flow={flow} message={f} onSelectNode={onSelectNode} onAfterClick={onAfterClick} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
