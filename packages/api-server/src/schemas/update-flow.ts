import { z } from "zod";

// Keep this in sync with FlowNode / FlowEdge in @journeyman/core/types/flow.types.ts.
// Zod strips fields not in the schema — missing entries silently corrupt saved data.
const flowInputValueSchema = z.union([
  z.object({ kind: z.literal("literal"), value: z.unknown() }),
  z.object({ kind: z.literal("ref"), ref: z.string() }),
]);

const flowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  displayName: z.string().optional(),
  phaseType: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  inputs: z.record(flowInputValueSchema).optional(),
  executorConfig: z.object({ provider: z.string().optional() }).passthrough().optional(),
  requiredSecrets: z.array(z.string()).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  outcome: z.string().optional(),
  retry: z.record(z.unknown()).optional(),
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
}).passthrough();

export const updateFlowBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  definition: flowGraphSchema.optional(),
});
export type UpdateFlowBody = z.infer<typeof updateFlowBody>;
