import { describe, it, expect } from "vitest";
import { FEW_SHOT_EXAMPLES, serializeFewShotExamples } from "./examples.ts";
import { assemblerIntentSchema } from "./intent-schema.ts";
import { assemble } from "../assembler/assemble.ts";

describe("FEW_SHOT_EXAMPLES", () => {
  it("has dev, qa and sre examples", () => {
    const goals = FEW_SHOT_EXAMPLES.map((e) => e.goal.toLowerCase()).join(" | ");
    expect(goals).toMatch(/ticket|develop|pr/);
    expect(goals).toMatch(/test|qa/);
    expect(goals).toMatch(/alert|sre|incident/);
  });

  it("every example validates against the intent schema", () => {
    for (const ex of FEW_SHOT_EXAMPLES) {
      expect(() => assemblerIntentSchema.parse(ex.intent)).not.toThrow();
    }
  });

  it("every example assembles to a graph whose edges connect real nodes", () => {
    for (const ex of FEW_SHOT_EXAMPLES) {
      const { workflow } = assemble(ex.intent);
      const ids = new Set(workflow.nodes.map((n) => n.id));
      expect(workflow.nodes.length).toBeGreaterThan(0);
      for (const e of workflow.edges) {
        expect(ids.has(e.source)).toBe(true);
        expect(ids.has(e.target)).toBe(true);
      }
    }
  });

  it("the QA example uses a gateway, the SRE example a human-task", () => {
    const qa = FEW_SHOT_EXAMPLES.find((e) => /test|qa/i.test(e.goal))!;
    const sre = FEW_SHOT_EXAMPLES.find((e) => /alert|sre|incident/i.test(e.goal))!;
    expect(assemble(qa.intent).workflow.nodes.some((n) => n.type === "gateway-xor")).toBe(true);
    expect(assemble(sre.intent).workflow.nodes.some((n) => n.type === "human-task")).toBe(true);
  });

  it("serializes to text containing each goal and the proposePlan label", () => {
    const text = serializeFewShotExamples();
    expect(text).toContain("Goal:");
    expect(text).toContain("proposePlan input:");
    for (const ex of FEW_SHOT_EXAMPLES) expect(text).toContain(ex.goal);
  });
});
