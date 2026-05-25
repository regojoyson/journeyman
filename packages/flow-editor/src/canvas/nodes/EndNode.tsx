import { Handle, Position } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";

interface Data {
  displayName?: string;
  outcome?: string;
}

export function EndNode({ data }: { data: Data }) {
  const label = data.displayName ?? "End";
  const subtitle = data.outcome ? `Outcome: ${data.outcome}` : "End of workflow";
  return (
    <div className="je-node je-node--end">
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__row">
        <div className="je-node__icon">■</div>
        <div className="je-node__text">
          <div className="je-node__label" title={label}>{label}</div>
          <div className="je-node__subtitle" title={subtitle}>{subtitle}</div>
        </div>
      </div>
    </div>
  );
}
