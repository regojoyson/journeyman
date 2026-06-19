import { describe, it, expect } from "vitest";
import { compileAgentToGraph } from "./compile.ts";
import type { Agent } from "@journeyman/core";

const baseAgent: Agent = {
  id: "ag1",
  workspaceId: "ws1",
  orgId: "o1",
  name: "Triage",
  instructions: "Fix {{ticketKey}}",
  inputs: [{ name: "ticketKey", type: "text", required: true }],
  provider: "claude",
  model: "claude-opus-4-8",
  connectorMcpIds: ["m1"],
  tools: ["bash", "read-file"],
  skillIds: ["s1"],
  repoSelections: [{ repo: "acme/api", branch: "main", allowWrites: false }],
  sandboxId: "sb1",
  permissions: { allowedTools: ["bash", "read-file"] },
  notifications: { on: ["failure"] },
  outputMode: "text",
  behavior: { maxTurns: 40, timeoutSeconds: 1800 },
  triggers: [],
  status: "active",
  enabled: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

describe("compileAgentToGraph", () => {
  it("builds trigger → agent-run → end with agent config on the step node", () => {
    const { graph } = compileAgentToGraph(baseAgent, { ticketKey: "PROJ-1" });
    expect(graph.schemaVersion).toBe(2);
    const stepNode = graph.nodes.find((n) => n.stepType === "agent-run")!;
    expect(stepNode).toBeTruthy();
    expect(stepNode.config!.agentId).toBe("ag1");
    expect(stepNode.config!.instructions).toBe("Fix {{ticketKey}}");
    expect(stepNode.config!.repos).toEqual(["acme/api"]);
    expect(stepNode.config!.maxSteps).toBe(40);
    expect(stepNode.config!.timeoutSeconds).toBe(1800);
    expect(stepNode.sandboxId).toBe("sb1");
    expect(stepNode.model).toBe("claude-opus-4-8");
    const trigger = graph.nodes.find((n) => n.type === "trigger-manual")!;
    expect(graph.edges.some((e) => e.source === trigger.id && e.target === stepNode.id)).toBe(true);
  });

  it("passes the repo's connectionId as gitConnectionId", () => {
    const agent = { ...baseAgent, repoSelections: [{ repo: "acme/api", allowWrites: false, connectionId: "conn-1" }] };
    const { graph } = compileAgentToGraph(agent, { ticketKey: "X" });
    const step = graph.nodes.find((n) => n.stepType === "agent-run")!;
    expect(step.config!.gitConnectionId).toBe("conn-1");
  });

  it("renders required inputs and rejects missing ones", () => {
    expect(() => compileAgentToGraph(baseAgent, {})).toThrow(/ticketKey/);
    const { inputs } = compileAgentToGraph(baseAgent, { ticketKey: "PROJ-1" });
    expect(inputs.ticketKey).toBe("PROJ-1");
  });
});
