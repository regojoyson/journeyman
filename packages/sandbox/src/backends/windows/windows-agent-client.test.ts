import { describe, it, expect } from "vitest";
import { makeWindowsAgentClient } from "./windows-agent-client.ts";

describe("makeWindowsAgentClient", () => {
  it("throws a clear error when certDir is missing/unreadable", () => {
    expect(() => makeWindowsAgentClient({ host: "h", port: 50051, certDir: "/nope" }))
      .toThrow(/cert/i);
  });

  it("requires host and port", () => {
    expect(() => makeWindowsAgentClient({ host: "", port: 0, certDir: "/nope" }))
      .toThrow(/host|port/i);
  });
});
