import type { CSSProperties, ReactNode } from "react";

export interface LegendRow {
  swatch: ReactNode;
  label: string;
  desc: string;
}

export interface NodeRow {
  icon: string;
  label: string;
  desc: string;
}

export interface NodeGroup {
  title: string;
  rows: NodeRow[];
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

// 1 — Build a flow (ordered)
export const BUILD_STEPS: string[] = [
  "Drag a node from the left \"Steps\" palette (grouped Triggers / Control / step categories) onto the canvas.",
  "Connect nodes by dragging from one handle to another — a handle turns green when it's a valid drop target.",
  "Wire failure handling by dragging from a node's red error handle.",
  "Click a node or edge to select it; its settings appear in the right panel.",
  "Drag a node to reposition; select it and press Delete to remove. The only trigger and the only End node can't be deleted.",
  "Cmd/Ctrl+S saves. Mouse-wheel zooms; drag the empty canvas to pan.",
];

// 2 — Node types (grouped; "Coming soon" nodes omitted)
export const NODE_GROUPS: NodeGroup[] = [
  {
    title: "Triggers (start a flow)",
    rows: [
      { icon: "▶",  label: "Manual",     desc: "Start by clicking Run or via the API." },
      { icon: "🪝", label: "Webhook",    desc: "Start when a webhook receives a matching event." },
      { icon: "📝", label: "Human form", desc: "Start when a person submits an in-app form." },
    ],
  },
  {
    title: "Steps",
    rows: [
      { icon: "⚙", label: "Step", desc: "A unit of work from the step catalog. Each step type has its own icon." },
    ],
  },
  {
    title: "Control",
    rows: [
      { icon: "■",  label: "End",          desc: "Terminal node — sets an outcome label. A flow may have several." },
      { icon: "?",  label: "If / Else",    desc: "Branch on a condition (then / else)." },
      { icon: "×",  label: "XOR",          desc: "Exactly one branch is taken." },
      { icon: "+",  label: "Fork",         desc: "Split the flow into parallel branches." },
      { icon: "⋈",  label: "Join",         desc: "Wait for parallel branches; choose how to handle errors." },
      { icon: "⏳", label: "Human Task",   desc: "Pause for a person to fill a form; optionally notify them." },
      { icon: "🔔", label: "Webhook Wait", desc: "Pause until a matching provider webhook arrives." },
    ],
  },
];

// 3a — Handles legend
export const HANDLES: LegendRow[] = [
  { swatch: <span style={dot("rgb(var(--color-info) / 1)")} />, label: "Blue dot",
    desc: "Flow input/output. Drag from one to another node to connect." },
  { swatch: <span style={dot("rgb(var(--color-danger) / 1)")} />, label: "Red dot",
    desc: "Error output. Connect to the node that handles failures for this step." },
  { swatch: <span style={dot("rgb(var(--color-success) / 1)", "rgba(0,184,148,0.55)")} />, label: "Green glow",
    desc: "Transient — appears while you're dragging a connection. Means \"valid drop target\"." },
];

// 3b — Edges legend
export const EDGES: LegendRow[] = [
  { swatch: <span style={lineSwatch("rgb(var(--color-text-muted) / 1)")} />,          label: "Solid grey",    desc: "Default flow." },
  { swatch: <span style={lineSwatch("rgb(var(--color-warning) / 1)", true)} />, label: "Dashed yellow", desc: "Conditional branch (labeled \"if\")." },
  { swatch: <span style={lineSwatch("rgb(var(--color-text-muted) / 1)", true)} />,    label: "Dashed grey",   desc: "Else branch." },
  { swatch: <span style={lineSwatch("rgb(var(--color-danger) / 1)", true)} />, label: "Dashed red",    desc: "Error path." },
];

// 4 — Publish & read-only
export const PUBLISH_STEPS: string[] = [
  "A flow is Draft (editable) or Ready (published). Publish from the topbar button.",
  "A Ready flow's canvas is read-only — use \"Move to Draft\" to edit it again.",
  "\"● unsaved\" in the topbar marks changes you haven't saved yet.",
];
