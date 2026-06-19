import { z } from "zod";

const inputIntent = z.union([
  z.object({ from: z.literal("literal"), value: z.unknown() }),
  z.object({ from: z.literal("workflow-input"), name: z.string() }),
  z.object({ from: z.literal("workflow-attribute"), name: z.string() }),
  z.object({ from: z.literal("step-output"), stepRef: z.string(), field: z.string() }),
  z.object({ from: z.literal("template"), template: z.string() }),
]);

const inputBinding = z.object({ slot: z.string(), value: inputIntent });

const inputType = z.enum(["string", "number", "boolean", "json-object", "json-array"]);
const webhookInput = z.object({ name: z.string(), type: inputType, fromPath: z.string() });

const trigger = z.union([
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("webhook"), webhookId: z.string().nullable(),
    listensFor: z.array(z.string()).optional(), inputs: z.array(webhookInput).optional() }),
  z.object({ kind: z.literal("form"), inputs: z.array(webhookInput).optional() }),
]);

const secretBinding = z.object({ slot: z.string(), secretName: z.string().nullable() });

const stepIntent = z.object({
  ref: z.string(),
  kind: z.enum(["provider", "ai", "human-task", "webhook-wait"]),
  label: z.string(),
  stepType: z.string().optional(),
  customStepId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  sandboxId: z.string().optional(),
  connection: z.string().optional(),
  secrets: z.array(secretBinding).optional(),
  inputs: z.array(inputBinding).optional(),
  waitWebhookId: z.string().nullable().optional(),
  assignee: z.string().optional(),
  taskPrompt: z.string().optional(),
});

const condition = z.object({
  left: z.union([
    z.object({ from: z.literal("step-output"), stepRef: z.string(), field: z.string() }),
    z.object({ from: z.literal("workflow-input"), name: z.string() }),
  ]),
  op: z.enum(["==", "!=", "<", "<=", ">", ">="]),
  right: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

const branch = z.object({ label: z.string(), condition, steps: z.array(stepIntent) });

const gateway = z.object({
  ref: z.string(), label: z.string(),
  branches: z.array(branch),
  elseBranch: z.object({ steps: z.array(stepIntent) }).optional(),
});

const customStepInputField = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "json-object", "json-array", "workspaceDir"]),
  required: z.boolean(),
  description: z.string().optional(),
});
const customStepOutputField = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "json-object", "json-array"]),
  required: z.boolean(),
  description: z.string().optional(),
});
const customStepCreateInput = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputFields: z.array(customStepInputField).optional(),
  outputMode: z.enum(["none", "text", "structured"]).optional(),
  outputFields: z.array(customStepOutputField).optional(),
  promptTemplate: z.string().optional(),
  defaultTools: z.array(z.string()).optional(),
  defaultMcpIds: z.array(z.string()).optional(),
  defaultSkillIds: z.array(z.string()).optional(),
});
const proposedCustomStep = z.object({ id: z.string(), step: customStepCreateInput });

export const assemblerIntentSchema = z.object({
  summary: z.string(),
  triggers: z.array(trigger),
  steps: z.array(stepIntent),
  gateway: gateway.optional(),
  newCustomSteps: z.array(proposedCustomStep).optional(),
  defaults: z.object({ sandboxId: z.string().nullable().optional(), model: z.string().nullable().optional() }).optional(),
});
