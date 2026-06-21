import type { FastifyReply } from "fastify";
import type { Workflow } from "@journeyman/core";

/**
 * Single source of truth for the workflow-trigger gate. Call from every ingress
 * (manual run, webhook → run, scheduler → run, retry). Writes the 409 reply
 * and returns false when the workflow is not Ready; returns true otherwise.
 */
export function assertWorkflowReady(workflow: Workflow, reply: FastifyReply): boolean {
  if (workflow.status !== "ready") {
    reply.code(409);
    void reply.send({ error: "workflow_not_ready", workflowId: workflow.id });
    return false;
  }
  return true;
}
