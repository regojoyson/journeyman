import { describe, it, expect } from "vitest";
import { confinementSystemPrompt } from "./index.ts";

describe("confinementSystemPrompt", () => {
  it("names the root and states the boundary", () => {
    const p = confinementSystemPrompt("/workspace");
    expect(p).toContain("/workspace");
    expect(p.toLowerCase()).toContain("workspace");
    expect(p).toContain("refuse");
  });
});
