import { z } from "zod";

// Keep this in sync with FlowNode / FlowEdge in @journeyman/core/types/flow.types.ts.
// Zod strips fields not in the schema — missing entries silently corrupt saved data.
const flowInputValueSchema = z.union([
  z.object({ kind: z.literal("literal"), value: z.unknown() }),
  z.object({ kind: z.literal("ref"), ref: z.string() }),
  z.object({ kind: z.literal("suppress") }),
]);

const secretBindingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({
    mode: z.literal("pinned"),
    scope: z.enum(["user", "org", "global"]),
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  }),
]);

const retryPolicySchema = z.object({
  enabled: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  backoff: z.enum(["fixed", "linear", "exponential"]).optional(),
  backoffSeconds: z.number().min(0).optional(),
  backoffMultiplier: z.number().min(1).optional(),
  timeoutSeconds: z.number().min(0).optional(),
  onFailure: z.enum(["error-edge", "fail-flow"]).optional(),
});

const executorKindSchema = z.enum(["coding-cli", "git-provider", "ticket-provider", "notification"]);

const flowDefaultsSchema = z.object({
  retry:          retryPolicySchema.optional(),
  executorConfig: z.record(executorKindSchema, z.object({ provider: z.string().optional() })).optional(),
  secretBindings: z.record(secretBindingSchema).optional(),
  inputs:         z.record(flowInputValueSchema).optional(),
}).optional();

const flowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  displayName: z.string().optional(),
  phaseType: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  inputs: z.record(flowInputValueSchema).nullable().optional(),
  executorConfig: z.object({ provider: z.string().optional() }).passthrough().nullable().optional(),
  secretBindings: z.record(secretBindingSchema).nullable().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  outcome: z.string().optional(),
  retry: retryPolicySchema.nullable().optional(),
}).passthrough();

const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(["default", "conditional", "error", "else"]).optional(),
  condition: z.unknown().optional(),
  label: z.string().optional(),
  branchLabel: z.string().optional(),
}).passthrough();

export const flowGraphSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
  maxCycleVisits: z.number().int().nonnegative().optional(),
  defaults: flowDefaultsSchema,
}).passthrough();

export const updateFlowBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  definition: flowGraphSchema.optional(),
});
export type UpdateFlowBody = z.infer<typeof updateFlowBody>;
