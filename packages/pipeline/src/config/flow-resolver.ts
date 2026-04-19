/**
 * @file flow-resolver.ts
 * Resolves which flow and product to use for an incoming pipeline trigger.
 *
 * Resolution order (highest priority first):
 *   1. `trigger.flowName` — explicit override sent by the caller.
 *   2. `config.products[productId].flow` — product-level default.
 *   3. `config.defaultFlow` — global fallback.
 *
 * Used by the server dispatcher to look up the correct FlowDefinition before
 * handing off to the Pipeline runner.
 */

import type { IFlowResolver, PipelineTrigger, PipelineConfig } from "@journeyman/core";

export class ConfigFlowResolver implements IFlowResolver {
  constructor(private readonly cfg: Pick<PipelineConfig, "defaultFlow" | "products">) {}

  async resolve(trigger: PipelineTrigger): Promise<{ flowName: string; productId: string }> {
    const productId = trigger.productId;
    const flowName =
      trigger.flowName
      ?? this.cfg.products[productId]?.flow
      ?? this.cfg.defaultFlow;
    return { flowName, productId };
  }
}
