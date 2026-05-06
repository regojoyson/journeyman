import type { Pool } from "pg";
import type { FlowDefinition, FlowStepDefinition } from "@journeyman/core";
import { findDefaultCodingModel } from "@journeyman/coding-models";

export async function resolveModelForStep(
  pool: Pool,
  flow: FlowDefinition,
  step: FlowStepDefinition,
): Promise<string | undefined> {
  if (step.model) return step.model;
  if (flow.defaultModel) return flow.defaultModel;
  const sysDefault = await findDefaultCodingModel(pool, flow.providers.coding);
  return sysDefault?.modelId;
}
