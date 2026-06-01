import { describe, it, expect } from "vitest";
import { isTerminalStatus } from "./workflow-instance.types.ts";

describe("isTerminalStatus", () => {
  it("treats completed/failed/cancelled as terminal", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });
  it("treats pending/running/paused as non-terminal", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("paused")).toBe(false);
  });
});
