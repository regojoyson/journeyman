import { z } from "zod";

export const updateFlowBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  definition: z.object({
    schemaVersion: z.literal(1),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.string(),
      displayName: z.string().optional(),
      phaseType: z.string().optional(),
      config: z.record(z.unknown()).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
    })),
    edges: z.array(z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: z.enum(["default", "conditional", "error", "else"]).optional(),
      condition: z.unknown().optional(),
      label: z.string().optional(),
    })),
    maxCycleVisits: z.number().int().nonnegative().optional(),
  }).optional(),
});
export type UpdateFlowBody = z.infer<typeof updateFlowBody>;
