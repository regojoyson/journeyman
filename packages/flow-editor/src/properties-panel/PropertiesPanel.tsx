import type { FlowNode } from "@journeyman/core";
import type { PhaseCatalog } from "../types.ts";
import { TabsShell } from "./tabs-shell.tsx";
import { ConfigTab } from "./ConfigTab.tsx";

export interface PropertiesPanelProps {
  node: FlowNode | null;
  catalog: PhaseCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { node, catalog, onChange, readOnly } = props;
  return (
    <aside className="je-editor__props">
      {!node && (
        <div className="je-empty">Select a node to configure it.</div>
      )}
      {node && (
        <>
          <div className="je-props__title">{node.displayName ?? node.type}</div>
          {node.type === "phase" ? (
            <TabsShell active="config">
              <ConfigTab node={node} catalog={catalog} onChange={onChange} readOnly={readOnly} />
            </TabsShell>
          ) : (
            <div className="je-empty">Terminal nodes have no configuration.</div>
          )}
        </>
      )}
    </aside>
  );
}
