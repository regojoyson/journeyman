import type { FlowGraph, FlowNodeType, McpTransport } from "@journeyman/core";

export interface PhaseCatalogEntry {
  /** Stable phase type id, e.g. "analyze". */
  phaseType: string;
  /** Label shown in the palette and as default node display name. */
  label: string;
  /** Category grouping in the palette: "AI" | "Tickets" | "Repos" | "Custom". */
  category: string;
  /** Short description shown on hover. */
  description?: string;
  /** Tailwind/hex color used for the tile accent. */
  color: string;
  /** Single emoji or icon character. Phase 2 uses emoji; Phase 5 swaps for SVGs. */
  icon: string;
}

export type PhaseCatalog = PhaseCatalogEntry[];

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
  phaseCatalog: PhaseCatalog;
  controlCatalog?: ControlNodeCatalog;
  mcpCatalog?: McpCatalog;
  onChange: (flow: FlowGraph) => void;
  onSave?: (flow: FlowGraph) => void | Promise<void>;
  onRun?: (flow: FlowGraph) => void | Promise<void>;
  readOnly?: boolean;
  busy?: boolean;
  onRename?: (newName: string) => void;
}
