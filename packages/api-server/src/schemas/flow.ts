import { z } from "zod";

export const createFlowBody = z.object({
  scope: z.enum(["user", "org", "global"]).default("user"),
  orgId: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  // ownerUserId removed — server derives from caller for user-scope.
  definition: z.object({
    schemaVersion: z.literal(1),
    nodes: z.array(z.object({
      id: z.string(),
      type: z.string(),
      displayName: z.string().optional(),
      phaseType: z.string().optional(),
      config: z.record(z.unknown()).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      outcome: z.string().optional(),
      retry: z.record(z.unknown()).optional(),
    })),
    edges: z.array(z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: z.enum(["default", "conditional", "error", "else"]).optional(),
      condition: z.unknown().optional(),
      label: z.string().optional(),
      branchLabel: z.string().optional(),
    })),
    maxCycleVisits: z.number().int().nonnegative().optional(),
  }),
});

export type CreateFlowBody = z.infer<typeof createFlowBody>;
