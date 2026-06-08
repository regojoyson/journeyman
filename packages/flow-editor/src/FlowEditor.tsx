// packages/flow-editor/src/FlowEditor.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "./canvas/Canvas.tsx";
import { PanelResizer } from "./canvas/PanelResizer.tsx";
import { Palette } from "./palette/Palette.tsx";
import { PropertiesPanel } from "./properties-panel/PropertiesPanel.tsx";
import { EdgeInspector } from "./inspector/EdgeInspector.tsx";
import { CreateFlowWizard } from "./create-wizard/CreateFlowWizard.tsx";
import { Topbar } from "./topbar/Topbar.tsx";
import { PublishModal } from "./topbar/PublishModal.tsx";
import { UnpublishDialog, type UnpublishWarning } from "./topbar/UnpublishDialog.tsx";
import { useFlowEditorState } from "./state/useFlowEditorState.ts";
import { isValidPhase4Graph } from "./state/validation.ts";
import { StepRegistryProvider } from "./state/step-registry-context.tsx";
import { OrgIdProvider } from "./state/org-context.tsx";
import { ValidationProvider } from "./state/validation-context.tsx";
import { useValidationCatalog } from "./properties-panel/use-validation-catalog.ts";
import { validateWorkflowInputs } from "@journeyman/core";
import type { FlowEditorProps } from "./types.ts";
import type { WorkflowGraph, WorkflowNode } from "@journeyman/core";

const PROPS_WIDTH_KEY = "je-editor:propsWidth";
const PALETTE_WIDTH_KEY = "je-editor:paletteWidth";

/** Best-effort safety net for flows missing required start/end nodes (e.g. corrupted save). */
function autoHeal(flow: WorkflowGraph): { healed: WorkflowGraph; restored: string[] } {
  const restored: string[] = [];
  let nodes = flow.nodes;
  if (!nodes.some(n =>
    n.type === "trigger-manual" || n.type === "trigger-webhook" || n.type === "trigger-human",
  )) {
    nodes = [{ id: "start", type: "trigger-manual", position: { x: 80, y: 200 } }, ...nodes];
    restored.push("trigger-manual");
  }
  if (!nodes.some(n => n.type === "end")) {
    nodes = [...nodes, { id: "end", type: "end", position: { x: 480, y: 200 } }];
    restored.push("end");
  }
  return restored.length ? { healed: { ...flow, nodes }, restored } : { healed: flow, restored };
}

export function FlowEditor(props: FlowEditorProps) {
  // Mount log — fires once on first render.
  const mountedRef = useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
    // eslint-disable-next-line no-console
    console.log("[FlowEditor] mounted", {
      nodes: props.flow.nodes.length,
      edges: props.flow.edges.length,
    });
  }

  // Render-loop detector — counts FlowEditor renders within a 1s window.
  const renderTimesRef = useRef<number[]>([]);
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  renderTimesRef.current.push(now);
  while (renderTimesRef.current.length && now - renderTimesRef.current[0] > 1000) {
    renderTimesRef.current.shift();
  }
  if (renderTimesRef.current.length > 25) {
    // eslint-disable-next-line no-console
    console.warn(
      `[flow-editor] FlowEditor rendered ${renderTimesRef.current.length}× in <1s — likely render loop.`,
      { flowNodes: props.flow.nodes.length, flowEdges: props.flow.edges.length },
    );
    renderTimesRef.current = [];
  }

  const heal = useMemo(() => {
    const result = autoHeal(props.flow);
    if (result.restored.length) {
      // eslint-disable-next-line no-console
      console.warn("[FlowEditor] autoHeal restored nodes", result.restored);
    }
    return result;
  }, [props.flow]);
  const [healDismissed, setHealDismissed] = useState(false);
  // If we healed, push the corrected flow back up so save persists it.
  // Guard with a ref so we don't re-fire onChange repeatedly if the parent
  // echoes back a flow that still appears to need healing (which would loop).
  const lastHealedSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!heal.restored.length) return;
    const sig = `${heal.healed.nodes.length}:${heal.healed.edges.length}:${heal.restored.join(",")}`;
    if (lastHealedSigRef.current === sig) {
      // eslint-disable-next-line no-console
      console.warn("[flow-editor] autoHeal would re-fire with identical signature — skipping to break loop.", { sig });
      return;
    }
    lastHealedSigRef.current = sig;
    props.onChange(heal.healed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heal.restored.join(",")]);

  const effectiveReadOnly = props.readOnly || props.status === "ready";
  const s = useFlowEditorState({ flow: heal.healed, onChange: props.onChange, readOnly: effectiveReadOnly });
  const validity = useMemo(() => {
    const t0 = performance.now();
    const result = isValidPhase4Graph(heal.healed);
    const elapsed = performance.now() - t0;
    if (elapsed > 20) {
      // eslint-disable-next-line no-console
      console.warn("[FlowEditor] isValidPhase4Graph slow", { ms: +elapsed.toFixed(2), nodes: heal.healed.nodes.length });
    }
    return result;
  }, [heal.healed]);

  const [propsWidth, setPropsWidth] = useState<number>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(PROPS_WIDTH_KEY) : null;
    const n = stored ? Number(stored) : NaN;
    return Number.isFinite(n) && n >= 220 && n <= 720 ? n : 320;
  });
  useEffect(() => {
    try { localStorage.setItem(PROPS_WIDTH_KEY, String(propsWidth)); } catch { /* ignore */ }
  }, [propsWidth]);

  const [paletteWidth, setPaletteWidth] = useState<number>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(PALETTE_WIDTH_KEY) : null;
    const n = stored ? Number(stored) : NaN;
    return Number.isFinite(n) && n >= 160 && n <= 480 ? n : 200;
  });
  useEffect(() => {
    try { localStorage.setItem(PALETTE_WIDTH_KEY, String(paletteWidth)); } catch { /* ignore */ }
  }, [paletteWidth]);

  const [setupOpen, setSetupOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [unpublishWarning, setUnpublishWarning] = useState<UnpublishWarning | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; tick: number } | undefined>(undefined);

  const focusNode = useCallback((id: string): void => {
    s.setSelectedNodeId(id);
    setFocusRequest(prev => ({ nodeId: id, tick: (prev?.tick ?? 0) + 1 }));
  }, [s]);

  const handlePublishClick = (): void => { setPublishOpen(true); };
  const handleUnpublishClick = async (): Promise<void> => {
    if (!props.onUnpublish) return;
    const w = await props.onUnpublish(false);
    if (w) {
      setUnpublishWarning(w);
      setUnpublishOpen(true);
    }
    // null → server flipped to draft directly; host re-renders with new status.
  };

  const onUpdateNode = (next: WorkflowNode) => {
    s.update(f => ({ ...f, nodes: f.nodes.map(n => n.id === next.id ? next : n) }));
  };

  const validationCatalog = useValidationCatalog(heal.healed);
  const inputWarnings = useMemo(() => {
    const t0 = performance.now();
    const result = validateWorkflowInputs(heal.healed, validationCatalog);
    const elapsed = performance.now() - t0;
    if (elapsed > 20) {
      // eslint-disable-next-line no-console
      console.warn("[FlowEditor] validateWorkflowInputs slow", { ms: +elapsed.toFixed(2), nodes: heal.healed.nodes.length });
    }
    return result;
  }, [heal.healed, validationCatalog]);

  return (
    <StepRegistryProvider steps={props.steps}>
     <OrgIdProvider orgId={props.orgId}>
      <ValidationProvider inputWarnings={inputWarnings} graphIssues={validity.issues}>
      <div className="je-editor">
        <Topbar
          flowName={props.flowName}
          onRename={effectiveReadOnly ? undefined : props.onRename}
          onSave={props.onSave ? () => props.onSave!(heal.healed) : undefined}
          onRun={props.onRun ? () => props.onRun!(heal.healed) : undefined}
          onValidate={props.onValidate ? () => props.onValidate!(heal.healed) : undefined}
          flow={heal.healed}
          busy={props.busy}
          saveEnabled={!effectiveReadOnly && !!props.onSave}
          runEnabled={!effectiveReadOnly && !!props.onRun && validity.ok && props.status !== "draft"}
          runDisabledReason={
            props.status === "draft"
              ? "Publish this flow to run it."
              : validity.ok ? undefined : validity.errors[0]
          }
          validationErrors={validity.errors}
          onWorkflowSetup={() => setSetupOpen(true)}
          onImport={effectiveReadOnly ? undefined : (flow) => props.onChange(flow)}
          status={props.status}
          onPublishClick={props.onPublish ? handlePublishClick : undefined}
          onUnpublishClick={props.onUnpublish ? handleUnpublishClick : undefined}
          onFocusNode={focusNode}
        />
        {effectiveReadOnly && props.status === "ready" && (
          <div className="fe-readonly-banner">
            This flow is published and read-only. Move to Draft to edit.
          </div>
        )}
        {heal.restored.length > 0 && !healDismissed && (
          <div className="je-editor__heal-banner">
            <span>
              Flow was missing {heal.restored.join(" and ")} node{heal.restored.length > 1 ? "s" : ""} — restored.
              Save to persist.
            </span>
            <button onClick={() => setHealDismissed(true)} aria-label="dismiss">×</button>
          </div>
        )}
        {(() => {
          const rightPanelOpen = !!s.selectedEdge || !!s.selectedNode;
          const gridCols = rightPanelOpen
            ? `${paletteWidth}px 6px 1fr 6px ${propsWidth}px`
            : `${paletteWidth}px 6px 1fr`;
          const closeRightPanel = (): void => {
            s.setSelectedNodeId(null);
            s.setSelectedEdgeId(null);
          };
          return (
            <div className="je-editor__body" style={{ gridTemplateColumns: gridCols }}>
              <Palette steps={props.steps} controlCatalog={props.controlCatalog} />
              <PanelResizer width={paletteWidth} onResize={setPaletteWidth} side="left" min={160} max={480} />
              <Canvas
                flow={heal.healed}
                selectedNodeId={s.selectedNodeId}
                onSelect={nodeId => { s.setSelectedNodeId(nodeId); }}
                onEdgeSelect={edgeId => { s.setSelectedEdgeId(edgeId); }}
                onChange={props.onChange}
                readOnly={effectiveReadOnly}
                stepRunStates={props.stepRunStates}
                focusRequest={focusRequest}
              />
              {rightPanelOpen && (
                <>
                  <PanelResizer width={propsWidth} onResize={setPropsWidth} side="right" />
                  {s.selectedEdge ? (
                    <EdgeInspector
                      flow={heal.healed}
                      edge={s.selectedEdge}
                      onChange={s.updateEdge}
                      onClose={closeRightPanel}
                    />
                  ) : (
                    <PropertiesPanel
                      flow={heal.healed}
                      node={s.selectedNode}
                      mcpCatalog={props.mcpCatalog ?? []}
                      orgId={props.orgId}
                      onChange={onUpdateNode}
                      onClose={closeRightPanel}
                      readOnly={effectiveReadOnly}
                    />
                  )}
                </>
              )}
            </div>
          );
        })()}
        {setupOpen && (
          <CreateFlowWizard
            mode="edit"
            initialGraph={heal.healed}
            initialMeta={{ name: props.flowName, description: "", scope: "user" }}
            orgId={props.orgId}
            readOnly={effectiveReadOnly}
            onSave={(graph) => { props.onChange(graph); setSetupOpen(false); }}
            onCancel={() => setSetupOpen(false)}
          />
        )}
        {publishOpen && props.onPublish && (
          <PublishModal
            flow={heal.healed}
            hasTrigger={true}
            onCancel={() => setPublishOpen(false)}
            onSelectNode={focusNode}
            onConfirm={async () => {
              const r = await props.onPublish!();
              if (r.ok && !r.warnings?.length) setPublishOpen(false);
              return r;
            }}
          />
        )}
        {unpublishOpen && props.onUnpublish && (
          <UnpublishDialog
            initialWarning={unpublishWarning}
            onCancel={() => { setUnpublishOpen(false); setUnpublishWarning(null); }}
            onConfirm={async (confirm) => {
              const w = await props.onUnpublish!(confirm);
              if (!w) {
                setUnpublishOpen(false);
                setUnpublishWarning(null);
              }
              return w;
            }}
          />
        )}
      </div>
      </ValidationProvider>
     </OrgIdProvider>
    </StepRegistryProvider>
  );
}
