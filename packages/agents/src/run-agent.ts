import type { Agent } from "@journeyman/core";
import { compileAgentToGraph } from "./compile.ts";

export type AgentTriggerSource = "manual" | "api" | "webhook" | "schedule";

export interface RunAgentDeps {
  orchestrator: {
    submit: (args: {
      workflowId: string | null;
      workflowVersionId: string | null;
      workflowNameSnapshot: string;
      workflowScopeSnapshot: "user" | "org" | "global";
      definitionSnapshot: ReturnType<typeof compileAgentToGraph>["graph"];
      inputs: Record<string, unknown>;
      startedByUserId: string | null;
      startedByOrgId: string | null;
      triggerSource?: AgentTriggerSource;
      triggerNodeId?: string | null;
    }) => Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }>;
  };
}

/**
 * The single path every trigger funnels through: compile the agent to an
 * ephemeral WorkflowGraph and submit it. Throws if a required input is missing
 * (compileAgentToGraph → MissingRequiredInputError).
 */
export async function runAgent(
  deps: RunAgentDeps,
  agent: Agent,
  inputs: Record<string, unknown>,
  triggerSource: AgentTriggerSource,
  startedBy: { userId: string | null; orgId: string },
  triggerNodeId = "trigger-1",
): Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }> {
  const compiled = compileAgentToGraph(agent, inputs);
  return deps.orchestrator.submit({
    workflowId: null,
    workflowVersionId: null,
    workflowNameSnapshot: agent.name,
    workflowScopeSnapshot: agent.scope,
    definitionSnapshot: compiled.graph,
    inputs: { ...compiled.inputs, agentId: agent.id },
    startedByUserId: startedBy.userId,
    startedByOrgId: startedBy.orgId,
    triggerSource,
    triggerNodeId,
  });
}
