/**
 * Optional capability interfaces that engines may implement on top of
 * IOrchestratorEngine. The api-server uses type-guard narrowing:
 *
 *   if (isPauseableEngine(c.orchestrator)) await c.orchestrator.pause(workflowInstanceId);
 *   else reply.code(501);
 */

import type { IOrchestratorEngine } from "./orchestrator-engine.interface.ts";

export interface IPauseableEngine extends IOrchestratorEngine {
  pause(workflowInstanceId: string): Promise<void>;
  resume(workflowInstanceId: string): Promise<void>;
}

export interface IRetryableEngine extends IOrchestratorEngine {
  /** Resume a failed/terminated workflow instance from a specific node, or from its last
   *  failed task when nodeId is undefined. */
  retryFromTask(workflowInstanceId: string, nodeId: string | undefined): Promise<void>;
}

export function isPauseableEngine(e: IOrchestratorEngine): e is IPauseableEngine {
  return typeof (e as Partial<IPauseableEngine>).pause === "function"
      && typeof (e as Partial<IPauseableEngine>).resume === "function";
}

export function isRetryableEngine(e: IOrchestratorEngine): e is IRetryableEngine {
  return typeof (e as Partial<IRetryableEngine>).retryFromTask === "function";
}
