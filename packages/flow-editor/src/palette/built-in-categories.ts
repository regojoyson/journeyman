import type { ControlNodeCatalog } from "../types.ts";

export const defaultControlCatalog: ControlNodeCatalog = [
  { nodeType: "if",            label: "If / Else",        category: "Logic",    color: "#74b9ff", icon: "?",  description: "Branch on a condition" },
  { nodeType: "gateway-xor",   label: "XOR",              category: "Logic",    color: "#74b9ff", icon: "×",  description: "Exactly one branch taken" },
  { nodeType: "gateway-and",   label: "AND (parallel)",   category: "Logic",    color: "#00b894", icon: "+",  description: "Run branches in parallel; join after" },
  { nodeType: "loop",          label: "Loop",             category: "Control",  color: "#fdcb6e", icon: "↻",  description: "Iterate body while condition holds" },
  { nodeType: "timer",         label: "Wait",             category: "Control",  color: "#fdcb6e", icon: "⏱",  description: "Pause for a duration or until a time" },
  { nodeType: "subflow",       label: "Subflow",          category: "Subflows", color: "#a29bfe", icon: "⊞",  description: "Invoke another flow as a step" },
];
