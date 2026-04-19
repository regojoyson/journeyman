/**
 * @file dispatch.ts
 * Builds the trigger dispatcher that safely enqueues pipeline runs.
 *
 * The dispatcher applies three layers of deduplication and concurrency control
 * before handing off to the Pipeline runner:
 *
 *  1. **Active-run check** — queries the state store for an existing run on the same
 *     ticket that is still queued/running/blocked. Returns it immediately (deduplicated).
 *  2. **TicketMutex** — prevents a second webhook for the same ticket from dispatching
 *     while the first is being set up (rapid-fire duplicate protection).
 *  3. **SemaphorePool** — limits how many flows run concurrently per product.
 *
 * The actual `pipeline.run()` call is fire-and-forget (void async IIFE) so the HTTP
 * response returns 202 immediately without waiting for the run to complete.
 */

import type { IFlowConfigSource, IFlowResolver, IStateStore, PipelineTrigger } from "@journeyman/core";
import { createLogger } from "@journeyman/core";
import type { Pipeline, SemaphorePool } from "@journeyman/pipeline";
import type { TicketMutex } from "./dedup.ts";

const log = createLogger("server:dispatch");

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
        log.error({ err, ticketKey: trigger.ticketKey }, "dispatch failure");
      } finally {
        release();
        deps.mutex.release(productId, trigger.ticketKey);
      }
    })();

    return {};
  };
}
