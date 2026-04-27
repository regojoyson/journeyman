import { useMemo, useState } from "react";
import { ReadOnlyCanvas } from "./canvas/ReadOnlyCanvas.tsx";
import { NodeDetailDrawer } from "./drawer/NodeDetailDrawer.tsx";
import { RunTopbar } from "./topbar/RunTopbar.tsx";
import { computeNodeStatuses } from "./status/compute-node-status.ts";
import type { RunViewerProps } from "./types.ts";
import "./styles.css";

export function RunViewer(props: RunViewerProps & { flowName?: string }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(props.initialSelectedNodeId ?? null);

  const statuses = useMemo(() => computeNodeStatuses({
    flow: props.flow, events: props.events, executions: props.executions, runStatus: props.run.status,
  }), [props.flow, props.events, props.executions, props.run.status]);

  const selectedNode = props.flow.nodes.find(n => n.id === selectedNodeId) ?? null;
  const selectedDisplayName = selectedNode?.displayName ?? selectedNode?.phaseType ?? selectedNode?.type ?? null;

  const eventsForSelected = useMemo(
    () => selectedNodeId ? props.events.filter(e => e.nodeId === selectedNodeId) : [],
    [props.events, selectedNodeId],
  );
  const execsForSelected = useMemo(
    () => selectedNodeId ? props.executions.filter(e => e.nodeId === selectedNodeId) : [],
    [props.executions, selectedNodeId],
  );

  return (
    <div className="je-runview">
      <RunTopbar
        flowName={props.flowName ?? "Run"}
        run={props.run}
        onRerun={props.onRerun}
      />
      <div className="je-runview__body">
        <ReadOnlyCanvas
          flow={props.flow}
          statuses={statuses}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
        />
        <NodeDetailDrawer
          nodeId={selectedNodeId}
          displayName={selectedDisplayName}
          status={selectedNodeId ? (statuses.get(selectedNodeId) ?? null) : null}
          events={eventsForSelected}
          executions={execsForSelected}
        />
      </div>
    </div>
  );
}
