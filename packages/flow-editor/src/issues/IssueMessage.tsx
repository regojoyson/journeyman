import { useMemo, type ReactElement } from "react";
import type { WorkflowGraph } from "@journeyman/core";

interface Props {
  flow: WorkflowGraph;
  message: string;
  onSelectNode: (id: string) => void;
  /** Called after a link click — e.g. to close the parent modal. */
  onAfterClick?: () => void;
}

type Token = { kind: "text"; value: string } | { kind: "id"; value: string };

/**
 * Tokenize a validation message, turning each `(<known-node-id>)` substring
 * into an `id` token. Parens are kept as plain text so the sentence still
 * reads naturally; only the bare ID becomes a link.
 *
 * Restricting matches to IDs that exist in `knownIds` prevents accidental
 * linking of arbitrary parenthetical text (e.g. "(json_logic)").
 */
export function tokenize(message: string, knownIds: Set<string>): Token[] {
  const tokens: Token[] = [];
  const re = /\(([^()]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    const inner = m[1];
    if (!knownIds.has(inner)) continue;
    if (start > lastIndex) tokens.push({ kind: "text", value: message.slice(lastIndex, start) });
    tokens.push({ kind: "text", value: "(" });
    tokens.push({ kind: "id", value: inner });
    tokens.push({ kind: "text", value: ")" });
    lastIndex = end;
  }
  if (lastIndex < message.length) {
    tokens.push({ kind: "text", value: message.slice(lastIndex) });
  }
  return tokens;
}

export function IssueMessage({ flow, message, onSelectNode, onAfterClick }: Props): ReactElement {
  const knownIds = useMemo(() => new Set(flow.nodes.map(n => n.id)), [flow.nodes]);
  const parts = useMemo(() => tokenize(message, knownIds), [message, knownIds]);
  return (
    <span className="je-issue-message">
      {parts.map((p, i) =>
        p.kind === "id" ? (
          <button
            key={i}
            type="button"
            className="je-issue-link"
            onClick={() => {
              onSelectNode(p.value);
              onAfterClick?.();
            }}
          >
            {p.value}
          </button>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </span>
  );
}
