import type { FastifyReply } from "fastify";
import type { Flow } from "@journeyman/core";

/**
 * Single source of truth for the run-trigger gate. Call from every ingress
 * (manual run, webhook → run, scheduler → run, retry). Writes the 409 reply
 * and returns false when the flow is not Ready; returns true otherwise.
 */
export function assertFlowReady(flow: Flow, reply: FastifyReply): boolean {
  if (flow.status !== "ready") {
    reply.code(409);
    void reply.send({ error: "flow_not_ready", flowId: flow.id });
    return false;
  }
  return true;
}
