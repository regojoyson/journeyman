import type { CSSProperties, ReactNode } from "react";

export interface LegendRow {
  swatch: ReactNode;
  label: string;
  desc: string;
}

const dot = (color: string, glow?: string): CSSProperties => ({
  display: "inline-block",
  width: 12,
  height: 12,
  borderRadius: "50%",
  background: color,
  boxShadow: glow ? `0 0 0 3px ${glow}` : undefined,
  flex: "0 0 auto",
});

const lineSwatch = (color: string, dashed?: boolean): CSSProperties => ({
  display: "inline-block",
  width: 28,
  height: 0,
  borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
  flex: "0 0 auto",
  marginTop: 6,
});

export const HANDLES: LegendRow[] = [
  { swatch: <span style={dot("#4a9eff")} />, label: "Blue dot",
    desc: "Default flow input/output. Drag from one to another node to connect." },
  { swatch: <span style={dot("#ff7675")} />, label: "Red dot",
    desc: "Error output. Connect to the node that handles failures for this phase." },
  { swatch: <span style={dot("#00b894", "rgba(0,184,148,0.55)")} />, label: "Green glow",
    desc: "Transient — appears while you're dragging a connection. Means \"valid drop target\"." },
  { swatch: <span style={dot("#fdcb6e")} />, label: "Yellow dot",
    desc: "Conditional output (XOR / If branches; shown only on those nodes)." },
];

export interface NodeRow {
  icon: string;
  label: string;
  desc: string;
}

export const NODES: NodeRow[] = [
  { icon: "▶", label: "Start",        desc: "Entry point of the flow." },
  { icon: "■", label: "End",          desc: "Terminal node." },
  { icon: "⚙", label: "Phase",        desc: "A unit of work — runs an action." },
  { icon: "◆", label: "Gateway XOR",  desc: "Pick exactly one of N branches." },
  { icon: "⬡", label: "Gateway AND",  desc: "Run all outgoing branches in parallel." },
  { icon: "↻", label: "Loop",         desc: "Repeat a sub-section of the flow." },
  { icon: "⊞", label: "Subflow",      desc: "Embed another flow as a single step." },
  { icon: "❓", label: "If",           desc: "Two-way conditional branch." },
  { icon: "⏱", label: "Timer",        desc: "Wait for a duration before continuing." },
];

export const EDGES: LegendRow[] = [
  { swatch: <span style={lineSwatch("#888")} />,         label: "Solid grey",   desc: "Default flow." },
  { swatch: <span style={lineSwatch("#fdcb6e")} />,      label: "Yellow",       desc: "Conditional branch." },
  { swatch: <span style={lineSwatch("#888", true)} />,   label: "Grey dashed",  desc: "Else branch." },
  { swatch: <span style={lineSwatch("#ff7675")} />,      label: "Red",          desc: "Error path." },
];

export const INTERACTIONS: string[] = [
  "Drag a node from the left palette onto the canvas to add it.",
  "Drag from a handle to another handle to connect.",
  "Click a node/edge to select it; properties show in the right panel.",
  "Drag a node to move; select + Delete to remove.",
  "Mouse wheel = zoom; click + drag empty canvas = pan.",
];

export const ADDING_PARAGRAPH =
  "Drag any item from the left \"Phases\" or \"Controls\" palette onto the canvas. " +
  "Then drag from its blue handle to another node's handle to connect them. " +
  "Wire up error paths by dragging from the red handle.";
