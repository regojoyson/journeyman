export { registerCustomPhaseRoutes } from "./routes/index.ts";
export {
  insertCustomAiPhase,
  getCustomAiPhase,
  listCustomAiPhases,
  listVisibleCustomAiPhases,
  updateCustomAiPhase,
  deleteCustomAiPhase,
  DuplicateCustomPhaseError,
} from "./db.ts";
export { renderPrompt, MissingRequiredInputError } from "./prompt-renderer.ts";
export { diffCustomPhase } from "./schema-diff.ts";
export type { CustomPhaseDiff } from "./schema-diff.ts";
export { buildCustomPhaseCatalog } from "./catalog.ts";
export type { CustomPhaseCatalogEntry } from "./catalog.ts";
export { customPhaseToShape } from "./shape-adapter.ts";
export type { CustomPhaseShape } from "./shape-adapter.ts";
export { assertScopeSafeDefaults, ScopeViolationError } from "./scope-guard.ts";
export type { ScopeLookup, ScopeOffender, ResourceScope, PhaseScope } from "./scope-guard.ts";
export { buildScopeLookup } from "./scope-lookup.ts";
export { toExportV1, fromExportV1, CustomPhaseImportError } from "./export.ts";
