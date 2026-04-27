import { useState } from "react";
import type { FlowGraph, FlowNode } from "@journeyman/core";
import type { McpCatalog, PhaseCatalog } from "../types.ts";
import { TabsShell, type TabId } from "./tabs-shell.tsx";
import { ConfigTab } from "./ConfigTab.tsx";
import { McpToolsTab } from "./McpToolsTab.tsx";
import { CredentialsTab } from "./CredentialsTab.tsx";
import { RetryTab } from "./RetryTab.tsx";
import { IoTab } from "./IoTab.tsx";
import { FlowSettingsView } from "./FlowSettingsView.tsx";

export interface PropertiesPanelProps {
  flow: FlowGraph;
  node: FlowNode | null;
  catalog: PhaseCatalog;
  mcpCatalog: McpCatalog;
  onChange: (next: FlowNode) => void;
  readOnly?: boolean;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { flow, node, catalog, mcpCatalog, onChange, readOnly } = props;
  const [active, setActive] = useState<TabId>("config");

  if (!node) {
    return (
      <aside className="je-editor__props">
        <div className="je-empty">Select a node to configure it.</div>
      </aside>
    );
  }

  if (node.type === "start") {
    return (
      <aside className="je-editor__props">
        <FlowSettingsView startNode={node} onChange={onChange} readOnly={readOnly} />
      </aside>
    );
  }

  const isPhase = node.type === "phase";

  return (
    <aside className="je-editor__props">
      <div className="je-props__title">{node.displayName ?? node.type}</div>
      {isPhase ? (
        <TabsShell active={active} onChange={setActive}>
          {active === "config"      && <ConfigTab    node={node} catalog={catalog} onChange={onChange} readOnly={readOnly} />}
          {active === "mcp"         && <McpToolsTab  node={node} catalog={mcpCatalog} onChange={onChange} readOnly={readOnly} />}
          {active === "credentials" && <CredentialsTab node={node} onChange={onChange} readOnly={readOnly} />}
          {active === "retry"       && <RetryTab     node={node} onChange={onChange} readOnly={readOnly} />}
          {active === "io"          && <IoTab        flow={flow} node={node} onChange={onChange} readOnly={readOnly} />}
        </TabsShell>
      ) : (
        <div className="je-empty">
          {node.type === "end" ? "End node — set the outcome label in the Inspector (Phase 6)." : "Control nodes have no per-tab config in v0."}
        </div>
      )}
    </aside>
  );
}
