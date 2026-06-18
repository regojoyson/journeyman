import { describe, it, expect, vi } from "vitest";
import { runAgent } from "./run-agent.ts";
import type { Agent } from "@journeyman/core";

const agent: Agent = {
  id: "ag1",
  scope: "org",
  orgId: "o1",
  name: "Triage",
  instructions: "do {{k}}",
  inputs: [{ name: "k", type: "text", required: true }],
  provider: "claude",
  model: "claude-opus-4-8",
  connectorMcpIds: [],
  tools: [],
  skillIds: [],
  repoSelections: [],
  permissions: { allowedTools: [] },
  notifications: { on: [] },
  outputMode: "text",
  behavior: {},
  triggers: [],
  status: "active",
  enabled: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

describe("runAgent", () => {
  it("compiles + submits with the trigger source and agentId in inputs", async () => {
    const submit = vi.fn().mockResolvedValue({ workflowInstanceId: "wi1", engineWorkflowId: null });
    const res = await runAgent({ orchestrator: { submit } }, agent, { k: "PROJ-1" }, "api", {
      userId: null,
      orgId: "o1",
    });
    expect(res.workflowInstanceId).toBe("wi1");
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerSource: "api",
        workflowNameSnapshot: "Triage",
        inputs: expect.objectContaining({ k: "PROJ-1", agentId: "ag1" }),
        startedByOrgId: "o1",
      }),
    );
  });

  it("throws when a required input is missing", async () => {
    const submit = vi.fn();
    await expect(runAgent({ orchestrator: { submit } }, agent, {}, "schedule", { userId: null, orgId: "o1" })).rejects.toThrow(/k/);
    expect(submit).not.toHaveBeenCalled();
  });
});
