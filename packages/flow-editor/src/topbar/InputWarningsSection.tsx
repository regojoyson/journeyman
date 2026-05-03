import type { FlowSaveWarning } from "@journeyman/core";

interface Props {
  warnings: FlowSaveWarning[];
  onSelectNode?: (nodeId: string) => void;
}

const INPUT_CODES = new Set([
  "shape-mismatch",
  "missing-required",
  "dangling-ref-node",
  "dangling-ref-path",
  "missing-input-shape",
]);

export function InputWarningsSection({ warnings, onSelectNode }: Props) {
  const filtered = warnings.filter((w) => INPUT_CODES.has(w.code));
  if (filtered.length === 0) return null;
  return (
    <div className="je-validate-section je-validate-section--warn">
      <div className="je-validate-section__title">Input warnings ({filtered.length})</div>
      {filtered.map((w, i) => {
        const nodeId = "nodeId" in w ? w.nodeId : undefined;
        return (
          <div
            key={`${w.code}-${i}`}
            className="je-topbar__warning-row--input"
            style={{ marginBottom: 6, fontSize: 12 }}
            onClick={() => nodeId && onSelectNode?.(nodeId)}
            title={nodeId ? `Click to focus ${nodeId}` : undefined}
          >
            <code style={{ marginRight: 6, fontSize: 11, opacity: 0.75 }}>{w.code}</code>
            {w.message}
          </div>
        );
      })}
    </div>
  );
}
