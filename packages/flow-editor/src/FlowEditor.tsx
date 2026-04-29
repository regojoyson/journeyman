// packages/flow-editor/src/FlowEditor.tsx
import { useEffect, useMemo, useState } from "react";
import { Canvas } from "./canvas/Canvas.tsx";
import { PanelResizer } from "./canvas/PanelResizer.tsx";
import { Palette } from "./palette/Palette.tsx";
import { PropertiesPanel } from "./properties-panel/PropertiesPanel.tsx";
import { Topbar } from "./topbar/Topbar.tsx";
import { useFlowEditorState } from "./state/useFlowEditorState.ts";
import { isValidPhase4Graph } from "./state/validation.ts";
import { PhaseRegistryProvider } from "./state/phase-registry-context.tsx";
import type { FlowEditorProps } from "./types.ts";
import type { FlowGraph, FlowNode } from "@journeyman/core";
import "./styles.css";

const PROPS_WIDTH_KEY = "je-editor:propsWidth";
const PALETTE_WIDTH_KEY = "je-editor:paletteWidth";

/** Best-effort safety net for flows missing required start/end nodes (e.g. corrupted save). */
function autoHeal(flow: FlowGraph): { healed: FlowGraph; restored: string[] } {
  const restored: string[] = [];
  let nodes = flow.nodes;
  if (!nodes.some(n => n.type === "start")) {
    nodes = [{ id: "start", type: "start", position: { x: 80, y: 200 } }, ...nodes];
    restored.push("start");
  }
  if (!nodes.some(n => n.type === "end")) {
    nodes = [...nodes, { id: "end", type: "end", position: { x: 480, y: 200 } }];
    restored.push("end");
  }
  return restored.length ? { healed: { ...flow, nodes }, restored } : { healed: flow, restored };
}

export function FlowEditor(props: FlowEditorProps) {
  const heal = useMemo(() => autoHeal(props.flow), [props.flow]);
  const [healDismissed, setHealDismissed] = useState(false);
  // If we healed, push the corrected flow back up so save persists it.
  useEffect(() => {
    if (heal.restored.length) props.onChange(heal.healed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heal.restored.join(",")]);

  const s = useFlowEditorState({ flow: heal.healed, onChange: props.onChange });
  const validity = useMemo(() => isValidPhase4Graph(heal.healed), [heal.healed]);

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

  const onUpdateNode = (next: FlowNode) => {
    s.update(f => ({ ...f, nodes: f.nodes.map(n => n.id === next.id ? next : n) }));
  };

  return (
    <PhaseRegistryProvider phases={props.phases}>
      <div className="je-editor">
        <Topbar
          flowName={props.flowName}
          onRename={props.onRename}
          onSave={props.onSave ? () => props.onSave!(heal.healed) : undefined}
          onRun={props.onRun ? () => props.onRun!(heal.healed) : undefined}
          onValidate={props.onValidate ? () => props.onValidate!(heal.healed) : undefined}
          flow={heal.healed}
          busy={props.busy}
          saveEnabled={!props.readOnly && !!props.onSave}
          runEnabled={!props.readOnly && !!props.onRun && validity.ok}
          runDisabledReason={validity.ok ? undefined : validity.errors[0]}
          validationErrors={validity.errors}
        />
        {heal.restored.length > 0 && !healDismissed && (
          <div className="je-editor__heal-banner">
            <span>
              Flow was missing {heal.restored.join(" and ")} node{heal.restored.length > 1 ? "s" : ""} — restored.
              Save to persist.
            </span>
            <button onClick={() => setHealDismissed(true)} aria-label="dismiss">×</button>
          </div>
        )}
        <div
          className="je-editor__body"
          style={{ gridTemplateColumns: `${paletteWidth}px 6px 1fr 6px ${propsWidth}px` }}
        >
          <Palette phases={props.phases} controlCatalog={props.controlCatalog} />
          <PanelResizer width={paletteWidth} onResize={setPaletteWidth} side="left" min={160} max={480} />
          <Canvas
            flow={heal.healed}
            selectedNodeId={s.selectedNodeId}
            onSelect={s.setSelectedNodeId}
            onChange={props.onChange}
            readOnly={props.readOnly}
            phaseRunStates={props.phaseRunStates}
          />
          <PanelResizer width={propsWidth} onResize={setPropsWidth} side="right" />
          <PropertiesPanel
            flow={heal.healed}
            node={s.selectedNode}
            mcpCatalog={props.mcpCatalog ?? []}
            onChange={onUpdateNode}
            readOnly={props.readOnly}
          />
        </div>
      </div>
    </PhaseRegistryProvider>
  );
}
