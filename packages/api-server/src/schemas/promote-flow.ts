import { z } from "zod";
export const promoteFlowBody = z.object({
  targetScope: z.enum(["org", "global"]),
  orgId: z.string().uuid().optional(),
  name: z.string().min(1).optional(),
});
export type PromoteFlowBody = z.infer<typeof promoteFlowBody>;
