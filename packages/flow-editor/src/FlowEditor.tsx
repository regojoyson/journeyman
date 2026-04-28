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
import type { FlowNode } from "@journeyman/core";
import "./styles.css";

const PROPS_WIDTH_KEY = "je-editor:propsWidth";

export function FlowEditor(props: FlowEditorProps) {
  const s = useFlowEditorState({ flow: props.flow, onChange: props.onChange });
  const validity = useMemo(() => isValidPhase4Graph(props.flow), [props.flow]);

  const [propsWidth, setPropsWidth] = useState<number>(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(PROPS_WIDTH_KEY) : null;
    const n = stored ? Number(stored) : NaN;
    return Number.isFinite(n) && n >= 220 && n <= 720 ? n : 320;
  });
  useEffect(() => {
    try { localStorage.setItem(PROPS_WIDTH_KEY, String(propsWidth)); } catch { /* ignore */ }
  }, [propsWidth]);

  const onUpdateNode = (next: FlowNode) => {
    s.update(f => ({ ...f, nodes: f.nodes.map(n => n.id === next.id ? next : n) }));
  };

  return (
    <PhaseRegistryProvider phases={props.phases}>
      <div className="je-editor">
        <Topbar
          flowName={props.flowName}
          onRename={props.onRename}
          onSave={props.onSave ? () => props.onSave!(props.flow) : undefined}
          onRun={props.onRun ? () => props.onRun!(props.flow) : undefined}
          onValidate={props.onValidate ? () => props.onValidate!(props.flow) : undefined}
          busy={props.busy}
          saveEnabled={!props.readOnly && !!props.onSave}
          runEnabled={!props.readOnly && !!props.onRun && validity.ok}
          runDisabledReason={validity.ok ? undefined : validity.errors[0]}
          validationErrors={validity.errors}
        />
        <div
          className="je-editor__body"
          style={{ gridTemplateColumns: `200px 1fr 6px ${propsWidth}px` }}
        >
          <Palette phases={props.phases} controlCatalog={props.controlCatalog} />
          <Canvas
            flow={props.flow}
            selectedNodeId={s.selectedNodeId}
            onSelect={s.setSelectedNodeId}
            onChange={props.onChange}
            readOnly={props.readOnly}
            phaseRunStates={props.phaseRunStates}
          />
          <PanelResizer width={propsWidth} onResize={setPropsWidth} side="right" />
          <PropertiesPanel
            flow={props.flow}
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
