import type { Pool } from "pg";
import type { Agent, AgentSkipReason } from "@journeyman/core";
import { compileAgentToGraph } from "./compile.ts";
import { enforceSafetyRails, incrementRunCounter } from "./safety.ts";

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

export type GuardedRunResult =
  | { workflowInstanceId: string; engineWorkflowId: string | null }
  | { skipped: AgentSkipReason };

export function wasSkipped(r: GuardedRunResult): r is { skipped: AgentSkipReason } {
  return "skipped" in r;
}

/**
 * runAgent + §15.1 safety rails. Checks paused/concurrency/daily-cap/budget
 * first; on a tripped rail returns `{ skipped: reason }` instead of submitting.
 * On a successful submit, bumps today's run counter (compile/input errors throw
 * before submit, so they never inflate the counter).
 */
export async function runAgentGuarded(
  deps: RunAgentDeps & { pool: Pool },
  agent: Agent,
  inputs: Record<string, unknown>,
  triggerSource: AgentTriggerSource,
  startedBy: { userId: string | null; orgId: string },
  triggerNodeId = "trigger-1",
): Promise<GuardedRunResult> {
  const verdict = await enforceSafetyRails(deps.pool, agent);
  if (!verdict.ok) return { skipped: verdict.reason };
  const res = await runAgent(deps, agent, inputs, triggerSource, startedBy, triggerNodeId);
  await incrementRunCounter(deps.pool, startedBy.orgId, agent.id).catch(() => undefined);
  return res;
}
