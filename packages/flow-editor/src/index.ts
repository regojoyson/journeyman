// packages/flow-editor/src/index.ts
export { FlowEditor } from "./FlowEditor.tsx";
export { createBlankFlow, isLinearAndComplete, isValidPhase4Graph } from "./state/flow-graph.ts";
export type {
  FlowEditorProps,
  ControlNodeCatalog, ControlNodeCatalogEntry,
  McpCatalog, McpCatalogEntry,
} from "./types.ts";
export type {
  PhaseDefinition,
  PhaseRunState,
  PhaseFormProps,
  FieldMeta,
  TabVisibility,
  ExecutorKind,
} from "./phase-definition.ts";
export { executorCommonConfig, defaultProviderFor } from "./executor-common-config.ts";
export { PhaseRegistry } from "./state/phase-registry.ts";
export { defaultControlCatalog } from "./palette/built-in-categories.ts";
export { defaultMcpCatalog } from "./catalogs/built-in-mcp-catalog.ts";
export { nodeTypes, edgeTypes } from "./canvas/node-registry.ts";
