import type { Agent, WorkflowGraph } from "@journeyman/core";

export class MissingRequiredInputError extends Error {
  constructor(name: string) {
    super(`missing required input: ${name}`);
    this.name = "MissingRequiredInputError";
  }
}

/** Resolve the run inputs from supplied values + defaults; throw if a required input is unsatisfied. */
export function resolveInputs(agent: Agent, supplied: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of agent.inputs) {
    const v = supplied[f.name] ?? f.default;
    if (f.required && (v === undefined || v === null || v === "")) throw new MissingRequiredInputError(f.name);
    if (v !== undefined) out[f.name] = v;
  }
  return out;
}

/**
 * Compile an agent into an ephemeral single-step WorkflowGraph:
 *   trigger-manual → agent-run step → end
 * The agent-run step config carries everything the handler needs.
 */
export function compileAgentToGraph(
  agent: Agent,
  suppliedInputs: Record<string, unknown> = {},
): { graph: WorkflowGraph; inputs: Record<string, unknown> } {
  const inputs = resolveInputs(agent, suppliedInputs);

  const graph: WorkflowGraph = {
    schemaVersion: 2,
    nodes: [
      { id: "trigger-1", type: "trigger-manual", displayName: "Start" },
      {
        id: "agent-run-1",
        type: "step",
        stepType: "agent-run",
        displayName: agent.name,
        sandboxId: agent.sandboxId,
        model: agent.model ?? null,
        retry: agent.behavior.retry ?? null,
        executorConfig: { provider: agent.provider },
        config: {
          agentId: agent.id,
          instructions: agent.instructions,
          provider: agent.provider,
          tools: agent.permissions.allowedTools.length ? agent.permissions.allowedTools : agent.tools,
          mcpInstanceIds: agent.connectorMcpIds,
          skillPackageIds: agent.skillIds,
          repos: agent.repoSelections.map((r) => r.repo),
          repoBranch: agent.repoSelections[0]?.branch,
          gitConnectionId: agent.repoSelections.find((r) => r.connectionId)?.connectionId,
          allowWrites: agent.repoSelections.some((r) => r.allowWrites),
          outputMode: agent.outputMode,
          outputFields: agent.outputFields ?? [],
          maxSteps: agent.behavior.maxTurns,
          timeoutSeconds: agent.behavior.timeoutSeconds,
        },
      },
      { id: "end-1", type: "end", displayName: "Done" },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "agent-run-1" },
      { id: "e2", source: "agent-run-1", target: "end-1" },
    ],
  };

  return { graph, inputs };
}
