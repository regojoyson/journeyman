import { z } from "zod";
export const cloneFlowBody = z.object({
  name: z.string().min(1).optional(),
});
export type CloneFlowBody = z.infer<typeof cloneFlowBody>;
