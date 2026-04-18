import type { IFlowConfigSource, IFlowResolver, IStateStore, PipelineTrigger } from "@journeyman/core";
import type { Pipeline, SemaphorePool } from "@journeyman/pipeline";
import type { TicketMutex } from "./dedup.ts";

export type DispatchDeps = {
  flows: IFlowConfigSource;
  resolver: IFlowResolver;
  pipeline: Pipeline;
  state: IStateStore;
  mutex: TicketMutex;
  semaphores: SemaphorePool;
};

export type DispatchResult = { sessionId?: string; deduplicated?: boolean };

export function buildDispatcher(deps: DispatchDeps): (trigger: PipelineTrigger) => Promise<DispatchResult> {
  return async (trigger) => {
    const { productId, flowName } = await deps.resolver.resolve(trigger);

    const existing = await deps.state.findActiveForTicket(productId, trigger.ticketKey);
    if (existing) return { sessionId: existing.sessionId, deduplicated: true };

    if (!deps.mutex.acquire(productId, trigger.ticketKey)) {
      return { deduplicated: true };
    }

    // Fire-and-forget run with per-product semaphore.
    void (async () => {
      const release = await deps.semaphores.acquire(productId);
      try {
        const flow = await deps.flows.getFlow(flowName);
        await deps.pipeline.run({ trigger: { ...trigger, productId }, flow });
      } catch (err) {
        console.error(`dispatch failure for ${trigger.ticketKey}:`, err);
      } finally {
        release();
        deps.mutex.release(productId, trigger.ticketKey);
      }
    })();

    return {};
  };
}
