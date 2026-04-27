export { FlowEditor } from "./FlowEditor.tsx";
export { createBlankFlow, isLinearAndComplete } from "./state/flow-graph.ts";
export type { FlowEditorProps, PhaseCatalog, PhaseCatalogEntry } from "./types.ts";
// Re-exports for run-viewer (and other consumers) so they can reuse the canvas look.
export { nodeTypes, edgeTypes } from "./canvas/node-registry.ts";
