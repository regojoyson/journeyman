import { z } from "zod";

export const CUSTOM_AI_PHASE_TYPE = "custom-ai";

export const customAiConfigSchema = z.object({
  customPhaseId: z.string().min(1),
  mcpInstanceIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
});
