import { describe, it, expect, vi, beforeEach } from "vitest";

const runAgentMock = vi.fn().mockResolvedValue({ workflowInstanceId: "wi1", engineWorkflowId: null });
const findAgentMock = vi.fn();
vi.mock("@journeyman/agents", () => ({
  findAgentByWebhookId: (...a: unknown[]) => findAgentMock(...a),
  runAgent: (...a: unknown[]) => runAgentMock(...a),
}));

import { fireAgentForWebhook } from "./agent-webhook-fire.ts";

beforeEach(() => {
  runAgentMock.mockClear();
  findAgentMock.mockReset();
});

function comp(evaluate = vi.fn().mockReturnValue(true)): any {
  return { pool: {}, conditions: { evaluate }, orchestrator: { submit: vi.fn() } };
}

describe("fireAgentForWebhook", () => {
  it("returns fired:0 when no agent uses the webhook", async () => {
    findAgentMock.mockResolvedValueOnce(null);
    const res = await fireAgentForWebhook(comp(), { webhookId: "wh1", rawPayload: {} });
    expect(res.fired).toBe(0);
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("maps the payload and fires the agent", async () => {
    findAgentMock.mockResolvedValueOnce({
      orgId: "o1",
      triggers: [{ type: "webhook", webhookId: "wh1", inputsMapping: { ticketKey: "$.issue.key" } }],
    });
    const res = await fireAgentForWebhook(comp(), { webhookId: "wh1", rawPayload: { issue: { key: "PROJ-1" } } });
    expect(res.fired).toBe(1);
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "o1" }),
      { ticketKey: "PROJ-1" },
      "webhook",
      expect.objectContaining({ orgId: "o1" }),
    );
  });

  it("skips (filtered) when the filter does not match", async () => {
    findAgentMock.mockResolvedValueOnce({
      orgId: "o1",
      triggers: [{ type: "webhook", webhookId: "wh1", inputsMapping: {}, filters: { "==": [{ var: "x" }, 1] } }],
    });
    const res = await fireAgentForWebhook(comp(vi.fn().mockReturnValue(false)), { webhookId: "wh1", rawPayload: { x: 2 } });
    expect(res).toEqual({ fired: 0, skipped: "filtered" });
    expect(runAgentMock).not.toHaveBeenCalled();
  });
});
