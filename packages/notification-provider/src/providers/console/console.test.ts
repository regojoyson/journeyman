/**
 * @file ConsoleProvider unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the logger before importing the module under test
const mockInfo = vi.fn();

vi.mock("@journeyman/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@journeyman/core")>();
  return {
    ...actual,
    createLogger: () => ({ info: mockInfo }),
  };
});

// Import after mock is set up
const { ConsoleProvider } = await import("./index.ts");

describe("ConsoleProvider", () => {
  beforeEach(() => {
    mockInfo.mockClear();
  });

  it("has correct meta.id and meta.category", () => {
    expect(ConsoleProvider.meta.id).toBe("console");
    expect(ConsoleProvider.meta.category).toBe("notification");
  });

  it("send() returns success with a string messageId and the input sessionId", async () => {
    const provider = new ConsoleProvider();
    const result = await provider.send({
      channel: "#general",
      message: "Hello",
      title: "Test",
      sessionId: "session-abc",
    });

    expect(result.success).toBe(true);
    expect(typeof result.messageId).toBe("string");
    expect(result.sessionId).toBe("session-abc");
  });

  it("send() calls log.info with the correct fields", async () => {
    const provider = new ConsoleProvider();
    await provider.send({
      channel: "#alerts",
      message: "Something happened",
      title: "Alert",
      sessionId: "session-xyz",
    });

    expect(mockInfo).toHaveBeenCalledOnce();
    const [obj, msg] = mockInfo.mock.calls[0];
    expect(obj).toMatchObject({
      channel: "#alerts",
      title: "Alert",
      message: "Something happened",
      sessionId: "session-xyz",
    });
    expect(msg).toBe("notify");
  });

  it("send() works when title is undefined", async () => {
    const provider = new ConsoleProvider();
    const result = await provider.send({
      channel: "#dev",
      message: "No title here",
      sessionId: "session-notitle",
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("session-notitle");

    const [obj] = mockInfo.mock.calls[0];
    expect(obj.title).toBeUndefined();
  });
});
