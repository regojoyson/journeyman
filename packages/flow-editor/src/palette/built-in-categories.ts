import type { ControlNodeCatalog } from "../types.ts";

export const defaultControlCatalog: ControlNodeCatalog = [
  { nodeType: "end",           label: "End",              category: "Flow",     color: "#ff7675", icon: "■",  description: "Terminal — set an outcome label (success, failed, …). A flow may have multiple end nodes." },
  { nodeType: "if",            label: "If / Else",        category: "Logic",    color: "#74b9ff", icon: "?",  description: "Branch on a condition", comingSoon: true },
  { nodeType: "gateway-xor",   label: "XOR",              category: "Logic",    color: "#74b9ff", icon: "×",  description: "Exactly one branch taken", comingSoon: true },
  { nodeType: "gateway-and",   label: "AND (parallel)",   category: "Logic",    color: "#00b894", icon: "+",  description: "Run branches in parallel; join after", comingSoon: true },
  { nodeType: "loop",          label: "Loop",             category: "Control",  color: "#fdcb6e", icon: "↻",  description: "Iterate body while condition holds", comingSoon: true },
  { nodeType: "timer",         label: "Wait",             category: "Control",  color: "#fdcb6e", icon: "⏱",  description: "Pause for a duration or until a time", comingSoon: true },
  { nodeType: "subflow",       label: "Subflow",          category: "Subflows", color: "#a29bfe", icon: "⊞",  description: "Invoke another flow as a step", comingSoon: true },
];
