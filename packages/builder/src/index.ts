// @journeyman/builder — conversational workflow builder (backend).
export { registerBuilderRoutes } from "./routes/index.ts";
export {
  insertBuilderSession,
  listBuilderSessions,
  getBuilderSession,
  updateBuilderSession,
  deleteBuilderSession,
  type Queryable,
} from "./db.ts";
export type {
  BuilderSessionRecord,
  BuilderSessionStatus,
  CreateBuilderSessionInput,
  UpdateBuilderSessionInput,
} from "./types.ts";
export { assemble, type AssembleResult, type AssembleDeps } from "./assembler/assemble.ts";
export type {
  AssemblerIntent, TriggerIntent, StepIntent, InputIntent, InputBindingIntent, WebhookInputIntent,
} from "./assembler/intent.ts";
export { detectGaps, type GapDeps } from "./assembler/gaps.ts";
export { toInputValue, refString, isValidNodeId } from "./assembler/refs.ts";
export { compileCondition } from "./assembler/conditions.ts";
export type { ConditionIntent, BranchIntent, GatewayIntent } from "./assembler/intent.ts";
export {
  serializeStepCatalog, serializeProviders, serializeNodeTypes, serializeInventory,
  type CatalogStepSummary, type ProviderSummary, type InventorySummary,
} from "./agent/serializers.ts";
export { buildApplyArgs, requiredGapsRemaining } from "./apply/apply-args.ts";
export { buildSystemPrompt, buildContextMessage, type ContextParts } from "./agent/prompt.ts";
export { resolveBuilderModel, builderLlmEnvFromProcess, type BuilderLlmEnv } from "./agent/model.ts";
export {
  runBuilderTurn, planFromIntent, makeAiSdkCaller,
  type BuilderModelCaller, type ChatMessage, type BuilderTurnResult,
} from "./agent/runner.ts";
export { assemblerIntentSchema } from "./agent/intent-schema.ts";
export { FEW_SHOT_EXAMPLES, serializeFewShotExamples, type FewShotExample } from "./agent/examples.ts";
export {
  evaluatePlan, scoreEval, runEval,
  hasStepType, hasNodeType, definesCustomStep, noRequiredGaps,
  type PlanCheck, type EvalCase, type EvalReport, type CheckResult,
} from "./agent/eval.ts";
export { applyBuildPlan, type ApplyDeps, type ApplyArgs, type ApplyResult } from "./apply/apply.ts";
export { rewriteCustomStepIds } from "./apply/rewrite.ts";
