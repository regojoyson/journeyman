import { describe, it, expect } from "vitest";
import { nextMaxStepsConfig } from "./ConfigTab.tsx";

describe("nextMaxStepsConfig", () => {
  it("stores a positive integer", () => {
    expect(nextMaxStepsConfig({}, "200")).toEqual({ maxSteps: 200 });
  });

  it("floors a decimal", () => {
    expect(nextMaxStepsConfig({}, "12.9")).toEqual({ maxSteps: 12 });
  });

  it("removes the key when cleared", () => {
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "")).toEqual({});
  });

  it("removes the key for zero, negative, or non-numeric input", () => {
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "0")).toEqual({});
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "-5")).toEqual({});
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "abc")).toEqual({});
  });

  it("preserves other config keys", () => {
    expect(nextMaxStepsConfig({ agentLogLevel: "all" }, "30")).toEqual({
      agentLogLevel: "all",
      maxSteps: 30,
    });
  });
});
