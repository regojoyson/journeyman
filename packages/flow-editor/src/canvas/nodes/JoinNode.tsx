import { Handle, Position, type NodeProps } from "@xyflow/react";
import { handleBlue } from "../handle-styles.ts";
import { NodeIssueBadges } from "./NodeIssueBadges.tsx";

export interface JoinNodeData {
  displayName?: string;
  config?: { errorMode?: "fail-fast" | "wait-all" | "wait-all-strict" | "first-wins" };
  pendingBranches?: number;
  [key: string]: unknown;
}

const MODE_LABEL: Record<string, string> = {
  "fail-fast": "fail-fast",
  "wait-all": "wait-all",
  "wait-all-strict": "wait-all (strict)",
  "first-wins": "first-wins",
};

export function JoinNode(props: NodeProps) {
  const data = props.data as JoinNodeData;
  const mode = data.config?.errorMode ?? "fail-fast";
  return (
    <div className="je-node je-node--gateway je-node--join">
      <NodeIssueBadges nodeId={props.id} />
      <Handle type="target" position={Position.Left} style={handleBlue} />
      <div className="je-node__icon">⋈</div>
      <div className="je-node__text">
        <div className="je-node__label">{data.displayName ?? "Join"}</div>
        <div className="je-node__subtitle">{MODE_LABEL[mode]}</div>
      </div>
      <Handle type="source" position={Position.Right} id="default" style={handleBlue} />
    </div>
  );
}
