import { z } from "zod";
import { flowGraphSchema } from "./update-flow.ts";

export const createFlowBody = z.object({
  scope: z.enum(["user", "org", "global"]).default("user"),
  orgId: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  // ownerUserId removed — server derives from caller for user-scope.
  definition: flowGraphSchema,
});

export type CreateFlowBody = z.infer<typeof createFlowBody>;
