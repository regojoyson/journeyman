import { useMemo, useState } from "react";
import { ReadOnlyCanvas } from "./canvas/ReadOnlyCanvas.tsx";
import { NodeDetailDrawer } from "./drawer/NodeDetailDrawer.tsx";
import { WorkflowInstanceTopbar } from "./topbar/RunTopbar.tsx";
import { computeNodeStatuses } from "./status/compute-node-status.ts";
import type { WorkflowInstanceViewerProps } from "./types.ts";
// Pull in flow-editor styles so PhaseNode (`je-node*`) and ReactFlow handle/edge
// overrides render correctly — WorkflowInstanceViewer reuses the editor's node components.
import "@journeyman/flow-editor/styles.css";
import "./styles.css";

export function WorkflowInstanceViewer(props: WorkflowInstanceViewerProps & { workflowName?: string }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(props.initialSelectedNodeId ?? null);

  const statuses = useMemo(() => computeNodeStatuses({
    workflow: props.workflow, events: props.events, executions: props.executions, workflowInstanceStatus: props.workflowInstance.status,
  }), [props.workflow, props.events, props.executions, props.workflowInstance.status]);

  const selectedNode = props.workflow.nodes.find(n => n.id === selectedNodeId) ?? null;
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
      <WorkflowInstanceTopbar
        workflowName={props.workflowName ?? "Workflow Instance"}
        workflowInstance={props.workflowInstance}
        onRerun={props.onRerun}
        onCancel={props.onCancel}
        onPause={props.onPause}
        onResume={props.onResume}
        onExport={props.onExport}
        onFork={props.onFork}
      />
      <div className="je-runview__body">
        <ReadOnlyCanvas
          workflow={props.workflow}
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
          onRetryStep={selectedNodeId && props.onRetryStep
            ? () => props.onRetryStep!(selectedNodeId)
            : undefined}
          pendingHumanTask={props.pendingHumanTask ?? null}
          onResolveHumanTask={props.onResolveHumanTask}
        />
      </div>
    </div>
  );
}
