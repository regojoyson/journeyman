import { useMemo } from "react";
import { Canvas } from "./canvas/Canvas.tsx";
import { Palette } from "./palette/Palette.tsx";
import { PropertiesPanel } from "./properties-panel/PropertiesPanel.tsx";
import { Topbar } from "./topbar/Topbar.tsx";
import { useFlowEditorState } from "./state/useFlowEditorState.ts";
import { isValidPhase4Graph } from "./state/validation.ts";
import type { FlowEditorProps } from "./types.ts";
import type { FlowNode } from "@journeyman/core";
import "./styles.css";

export function FlowEditor(props: FlowEditorProps) {
  const s = useFlowEditorState({ flow: props.flow, onChange: props.onChange });
  const validity = useMemo(() => isValidPhase4Graph(props.flow), [props.flow]);

  const onUpdateNode = (next: FlowNode) => {
    s.update(f => ({ ...f, nodes: f.nodes.map(n => n.id === next.id ? next : n) }));
  };

  return (
    <div className="je-editor">
      <Topbar
        flowName={props.flowName}
        onRename={props.onRename}
        onSave={props.onSave ? () => props.onSave!(props.flow) : undefined}
        onRun={props.onRun ? () => props.onRun!(props.flow) : undefined}
        busy={props.busy}
        saveEnabled={!props.readOnly && !!props.onSave}
        runEnabled={!props.readOnly && !!props.onRun && validity.ok}
        runDisabledReason={validity.ok ? undefined : validity.errors[0]}
        validationErrors={validity.errors}
      />
      <div className="je-editor__body">
        <Palette catalog={props.phaseCatalog} controlCatalog={props.controlCatalog} />
        <Canvas
          flow={props.flow}
          catalog={props.phaseCatalog}
          selectedNodeId={s.selectedNodeId}
          onSelect={s.setSelectedNodeId}
          onChange={props.onChange}
          readOnly={props.readOnly}
        />
        <PropertiesPanel
          flow={props.flow}
          node={s.selectedNode}
          catalog={props.phaseCatalog}
          mcpCatalog={props.mcpCatalog ?? []}
          onChange={onUpdateNode}
          readOnly={props.readOnly}
        />
      </div>
    </div>
  );
}
