import { useEffect, useMemo, useState } from "react";
import { PanelResizer } from "@journeyman/flow-editor";
import { ReadOnlyCanvas } from "./canvas/ReadOnlyCanvas.tsx";
import { NodeDetailDrawer } from "./drawer/NodeDetailDrawer.tsx";
import { WorkflowInstanceTopbar } from "./topbar/RunTopbar.tsx";
import { WorkflowLogsPanel } from "./logs/WorkflowLogsPanel.tsx";
import { computeNodeStatuses } from "./status/compute-node-status.ts";
import type { WorkflowInstanceViewerProps } from "./types.ts";
// Pull in flow-editor styles so PhaseNode (`je-node*`) and ReactFlow handle/edge
// overrides render correctly — WorkflowInstanceViewer reuses the editor's node components.
import "@journeyman/flow-editor/styles.css";
import "./styles.css";

const DRAWER_WIDTH_KEY = "je-runview:drawerWidth";
const DRAWER_WIDTH_DEFAULT = 360;
const DRAWER_WIDTH_MIN = 280;
const DRAWER_WIDTH_MAX = 900;

const LOGS_OPEN_KEY = "je-runview:logsOpen";
const LOGS_HEIGHT_KEY = "je-runview:logsHeight";
const LOGS_HEIGHT_DEFAULT = 240;
const LOGS_HEIGHT_MIN = 120;
function logsHeightMax(): number {
  if (typeof window === "undefined") return 800;
  return Math.max(LOGS_HEIGHT_MIN, Math.floor(window.innerHeight * 0.7));
}

export function WorkflowInstanceViewer(props: WorkflowInstanceViewerProps & { workflowName?: string }) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(props.initialSelectedNodeId ?? null);

  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(DRAWER_WIDTH_KEY) : null;
    const n = stored ? Number(stored) : NaN;
    return Number.isFinite(n) && n >= DRAWER_WIDTH_MIN && n <= DRAWER_WIDTH_MAX ? n : DRAWER_WIDTH_DEFAULT;
  });
  useEffect(() => {
    try { localStorage.setItem(DRAWER_WIDTH_KEY, String(drawerWidth)); } catch { /* ignore */ }
  }, [drawerWidth]);

  const [logsOpen, setLogsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LOGS_OPEN_KEY) === "1";
  });
  useEffect(() => {
    try { localStorage.setItem(LOGS_OPEN_KEY, logsOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [logsOpen]);

  const [logsHeight, setLogsHeight] = useState<number>(() => {
    if (typeof window === "undefined") return LOGS_HEIGHT_DEFAULT;
    const stored = localStorage.getItem(LOGS_HEIGHT_KEY);
    const n = stored ? Number(stored) : NaN;
    const max = logsHeightMax();
    return Number.isFinite(n) && n >= LOGS_HEIGHT_MIN && n <= max ? n : LOGS_HEIGHT_DEFAULT;
  });
  useEffect(() => {
    try { localStorage.setItem(LOGS_HEIGHT_KEY, String(logsHeight)); } catch { /* ignore */ }
  }, [logsHeight]);
  useEffect(() => {
    const onResize = () => {
      const max = logsHeightMax();
      setLogsHeight(prev => Math.min(prev, max));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  const totalLogCount = props.events.length;

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
        onRefresh={props.onRefresh}
        logsOpen={logsOpen}
        logsCount={totalLogCount}
        onToggleLogs={() => setLogsOpen(v => !v)}
      />
      <div
        className="je-runview__body"
        style={{ gridTemplateColumns: `1fr 6px ${drawerWidth}px` }}
      >
        <ReadOnlyCanvas
          workflow={props.workflow}
          statuses={statuses}
          selectedNodeId={selectedNodeId}
          onSelect={setSelectedNodeId}
        />
        <PanelResizer
          width={drawerWidth}
          onResize={setDrawerWidth}
          side="right"
          min={DRAWER_WIDTH_MIN}
          max={DRAWER_WIDTH_MAX}
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
      {logsOpen && (
        <WorkflowLogsPanel
          events={props.events}
          nodes={props.workflow.nodes}
          height={logsHeight}
          onResizeHeight={(next) => {
            const max = logsHeightMax();
            setLogsHeight(Math.min(max, Math.max(LOGS_HEIGHT_MIN, next)));
          }}
          onClose={() => setLogsOpen(false)}
        />
      )}
    </div>
  );
}
