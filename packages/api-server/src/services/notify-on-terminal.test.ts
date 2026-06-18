import { describe, it, expect, vi, beforeEach } from "vitest";

const getAgentMock = vi.fn();
const getConnectionMock = vi.fn();
const getConnectionSealedMock = vi.fn();
const openMock = vi.fn().mockReturnValue("decrypted-secret");
const slackSendMock = vi.fn().mockResolvedValue({ success: true });
const consoleSendMock = vi.fn().mockResolvedValue({ success: true });

vi.mock("@journeyman/agents", () => ({
  getAgent: (...a: unknown[]) => getAgentMock(...a),
}));
vi.mock("@journeyman/connections", () => ({
  getConnection: (...a: unknown[]) => getConnectionMock(...a),
  getConnectionSealed: (...a: unknown[]) => getConnectionSealedMock(...a),
}));
vi.mock("@journeyman/secrets", () => ({
  open: (...a: unknown[]) => openMock(...a),
}));
vi.mock("@journeyman/notification-provider", () => ({
  SlackProvider: class {
    send = slackSendMock;
  },
  ConsoleProvider: class {
    send = consoleSendMock;
  },
}));

import { makeNotifyOnTerminal } from "./notify-on-terminal.ts";

function deps(getById: any) {
  return { pool: {} as any, workflowInstances: { getById } as any };
}

beforeEach(() => {
  getAgentMock.mockReset();
  getConnectionMock.mockReset();
  getConnectionSealedMock.mockReset();
  slackSendMock.mockClear();
  consoleSendMock.mockClear();
});

describe("makeNotifyOnTerminal", () => {
  it("does nothing for non-terminal statuses", async () => {
    const notify = makeNotifyOnTerminal(deps(vi.fn()));
    await notify("wi1", "running" as any);
    expect(getAgentMock).not.toHaveBeenCalled();
  });

  it("does nothing when the instance has no agentId", async () => {
    const notify = makeNotifyOnTerminal(deps(vi.fn().mockResolvedValue({ inputs: {} })));
    await notify("wi1", "completed");
    expect(getAgentMock).not.toHaveBeenCalled();
  });

  it("skips when the agent does not subscribe to the terminal state", async () => {
    getAgentMock.mockResolvedValue({ name: "A", notifications: { on: ["failure"], connectionId: "c1" } });
    const notify = makeNotifyOnTerminal(deps(vi.fn().mockResolvedValue({ inputs: { agentId: "a1" } })));
    await notify("wi1", "completed");
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(slackSendMock).not.toHaveBeenCalled();
  });

  it("sends a Slack failure notification (token method)", async () => {
    getAgentMock.mockResolvedValue({
      name: "Dev Agent",
      notifications: { on: ["failure"], connectionId: "c1", target: "#alerts" },
    });
    getConnectionMock.mockResolvedValue({ category: "notification", provider: "slack", config: { method: "token" } });
    getConnectionSealedMock.mockResolvedValue({ ciphertext: Buffer.from("x"), iv: Buffer.from("y"), authTag: Buffer.from("z") });

    const notify = makeNotifyOnTerminal(deps(vi.fn().mockResolvedValue({ inputs: { agentId: "a1" } })));
    await notify("wi1", "failed");

    expect(slackSendMock).toHaveBeenCalledOnce();
    const arg = slackSendMock.mock.calls[0][0];
    expect(arg.channel).toBe("#alerts");
    expect(arg.title).toContain("Dev Agent");
    expect(arg.title).toContain("failed");
    expect(consoleSendMock).not.toHaveBeenCalled();
  });

  it("uses ConsoleProvider for a console connection", async () => {
    getAgentMock.mockResolvedValue({ name: "A", notifications: { on: ["success"], connectionId: "c1" } });
    getConnectionMock.mockResolvedValue({ category: "notification", provider: "console" });

    const notify = makeNotifyOnTerminal(deps(vi.fn().mockResolvedValue({ inputs: { agentId: "a1" } })));
    await notify("wi1", "completed");

    expect(consoleSendMock).toHaveBeenCalledOnce();
    expect(getConnectionSealedMock).not.toHaveBeenCalled();
  });

  it("skips when the connection is not a notification connection", async () => {
    getAgentMock.mockResolvedValue({ name: "A", notifications: { on: ["success"], connectionId: "c1" } });
    getConnectionMock.mockResolvedValue({ category: "git", provider: "github" });

    const notify = makeNotifyOnTerminal(deps(vi.fn().mockResolvedValue({ inputs: { agentId: "a1" } })));
    await notify("wi1", "completed");

    expect(slackSendMock).not.toHaveBeenCalled();
    expect(consoleSendMock).not.toHaveBeenCalled();
  });

  it("never throws when send fails", async () => {
    getAgentMock.mockResolvedValue({ name: "A", notifications: { on: ["success"], connectionId: "c1" } });
    getConnectionMock.mockResolvedValue({ category: "notification", provider: "console" });
    consoleSendMock.mockRejectedValueOnce(new Error("boom"));

    const notify = makeNotifyOnTerminal(deps(vi.fn().mockResolvedValue({ inputs: { agentId: "a1" } })));
    await expect(notify("wi1", "completed")).resolves.toBeUndefined();
  });
});
