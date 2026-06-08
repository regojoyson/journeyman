import { describe, it, expect } from "vitest";
import { buildInputCompletions, buildSlotCompletions } from "./completion-options.ts";

describe("buildInputCompletions", () => {
  it("closes the braces in the inserted label and shows type detail", () => {
    const c = buildInputCompletions([{ name: "pr", type: "string", required: true }]);
    expect(c[0].label).toBe("pr}}");
    expect(c[0].displayLabel).toBe("pr");
    expect(c[0].detail).toBe("string · required");
  });
});

describe("buildSlotCompletions", () => {
  it("uses the slot name as the label and marks optional", () => {
    const c = buildSlotCompletions([{ name: "GH_TOKEN", description: "GitHub token", optional: true }]);
    expect(c[0].label).toBe("GH_TOKEN");
    expect(c[0].detail).toBe("env · optional");
    expect(c[0].info).toBe("GitHub token");
  });
});
