import { describe, it, expect } from "vitest";
import { runActionVisible } from "./flows-list-actions.ts";

describe("runActionVisible", () => {
  it("shows Run for an editable, published workflow", () => {
    expect(runActionVisible(true, "ready")).toBe(true);
  });

  it("hides Run for a draft workflow", () => {
    expect(runActionVisible(true, "draft")).toBe(false);
  });

  it("hides Run for a read-only user even when published", () => {
    expect(runActionVisible(false, "ready")).toBe(false);
  });
});
