import type { FlowGraph } from "@journeyman/core";

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

export interface FlowEditorProps {
  /** The flow graph being edited. Treated as the canonical state. */
  flow: FlowGraph;
  /** Display name shown in the topbar. */
  flowName: string;
  /** Phase types available in the palette. */
  phaseCatalog: PhaseCatalog;
  /** Called whenever the user changes the graph (drag, edit, etc.). */
  onChange: (flow: FlowGraph) => void;
  /** Called when the user clicks Save in the topbar. */
  onSave?: (flow: FlowGraph) => void | Promise<void>;
  /** Called when the user clicks Run. */
  onRun?: (flow: FlowGraph) => void | Promise<void>;
  /** Read-only mode — disables editing, hides Save. Used later for Run view. */
  readOnly?: boolean;
  /** "Saving…" / "Running…" indicator. */
  busy?: boolean;
  /** Header rename callback. Optional — omit to make the title read-only. */
  onRename?: (newName: string) => void;
}
