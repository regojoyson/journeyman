import { z } from "zod";

export const FlowSchema = z.object({
  name: z.string().min(1),
  providers: z.object({
    ticket: z.string().min(1),
    git: z.string().min(1),
    coding: z.string().min(1),
    notification: z.string().min(1),
  }),
  steps: z.array(z.object({
    id: z.string().min(1).optional(),
    phase: z.string().min(1),
    config: z.record(z.unknown()).optional(),
    retry: z.object({
      attempts: z.number().int().min(1),
      backoffMs: z.number().int().min(0),
    }).optional(),
    timeoutMs: z.number().int().min(0).optional(),
    onFailure: z.enum(["fail", "skip", "retry", "block"]).optional(),
  })).min(1),
});
