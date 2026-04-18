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
