import { describe, it, expect } from "vitest";
import { parseSseBuffer } from "./sse-parse.ts";

describe("parseSseBuffer", () => {
  it("parses complete frames and returns the incomplete tail as rest", () => {
    const buf = "event: assistant\ndata: {\"message\":\"hi\"}\n\nevent: plan\ndata: {\"summary\":\"x\"}\n\nevent: don";
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toEqual([
      { event: "assistant", data: '{"message":"hi"}' },
      { event: "plan", data: '{"summary":"x"}' },
    ]);
    expect(rest).toBe("event: don");
  });

  it("ignores comment/ping frames (no data line)", () => {
    const { events, rest } = parseSseBuffer(": ping\n\n");
    expect(events).toEqual([]);
    expect(rest).toBe("");
  });

  it("defaults the event name to 'message' when only data is present", () => {
    const { events } = parseSseBuffer("data: hello\n\n");
    expect(events).toEqual([{ event: "message", data: "hello" }]);
  });
});
