import { z } from "zod";

// Keep this in sync with FlowNode / FlowEdge in @journeyman/core/types/flow.types.ts.
// Zod strips fields not in the schema — missing entries silently corrupt saved data.
const flowInputValueSchema = z.union([
  z.object({ kind: z.literal("literal"), value: z.unknown() }),
  z.object({ kind: z.literal("ref"), ref: z.string() }),
  z.object({ kind: z.literal("template"), template: z.string() }),
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

const flowDefaultsSchema = z.object({
  retry:          retryPolicySchema.optional(),
  // Two-arg z.record(keySchema, valueSchema): required by zod 4, valid in zod 3.
  // (A string key avoids zod 4's exhaustive enum-keyed-record behavior.)
  executorConfig: z.record(z.string(), z.object({ provider: z.string().optional() })).optional(),
  defaultModel:   z.string().optional(),
  // The editor picker writes `sandboxId`. It must be accepted explicitly or the
  // picker's value is silently stripped on save (Zod .object() drops unknown keys).
  sandboxId: z.string().optional(),
}).optional();

const flowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  displayName: z.string().optional(),
  stepType: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  inputs: z.record(z.string(), flowInputValueSchema).nullable().optional(),
  executorConfig: z.object({ provider: z.string().optional() }).passthrough().nullable().optional(),
  secretBindings: z.record(z.string(), secretBindingSchema).nullable().optional(),
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
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
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
