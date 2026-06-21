import { z } from "zod";
import { flowGraphSchema } from "./update-flow.ts";

export const createFlowBody = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  definition: flowGraphSchema,
});

export type CreateFlowBody = z.infer<typeof createFlowBody>;
