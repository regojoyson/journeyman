import type { FlowGraph, FlowNodeType, McpTransport } from "@journeyman/core";
import type { PhaseDefinition, PhaseRunState } from "./phase-definition.ts";

export interface ControlNodeCatalogEntry {
  nodeType: FlowNodeType;
  label: string;
  category: string;
  description?: string;
  color: string;
  icon: string;
}
export type ControlNodeCatalog = ControlNodeCatalogEntry[];

export interface McpCatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
}
export type McpCatalog = McpCatalogEntry[];

export interface FlowEditorProps {
  flow: FlowGraph;
  flowName: string;
  /** Built-in or extension phase definitions, used to power the palette, properties panel, and canvas. */
  phases: PhaseDefinition<any>[];
  controlCatalog?: ControlNodeCatalog;
  mcpCatalog?: McpCatalog;
  /** Optional runtime status keyed by node id. When undefined, no status badge is rendered. */
  phaseRunStates?: Record<string, PhaseRunState>;
  onChange: (flow: FlowGraph) => void;
  onSave?: (flow: FlowGraph) => void | Promise<void>;
  onRun?: (flow: FlowGraph) => void | Promise<void>;
  /** Non-destructive preflight check. Returns a structured report. */
  onValidate?: (flow: FlowGraph) => Promise<{
    ok: boolean; errors: string[]; missing: string[]; warnings: string[];
  }>;
  readOnly?: boolean;
  busy?: boolean;
  onRename?: (newName: string) => void;
}
