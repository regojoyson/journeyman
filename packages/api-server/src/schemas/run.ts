import { z } from "zod";

export const createRunBody = z.object({
  inputs: z.record(z.unknown()).default({}),
});
export type CreateRunBody = z.infer<typeof createRunBody>;
