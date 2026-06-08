import { describe, it, expect } from "vitest";
import { analyzeReferences } from "./prompt-tokens.ts";

describe("analyzeReferences", () => {
  it("collects known input and slot references", () => {
    const r = analyzeReferences("Hi {{name}} use $TOKEN", new Set(["name"]), new Set(["TOKEN"]));
    expect([...r.inputs]).toEqual(["name"]);
    expect([...r.slots]).toEqual(["TOKEN"]);
    expect(r.unknownInputs).toEqual([]);
    expect(r.unknownSlots).toEqual([]);
  });

  it("flags each undeclared token once", () => {
    const r = analyzeReferences("{{a}} {{a}} $X $X", new Set(), new Set());
    expect(r.unknownInputs).toEqual(["a"]);
    expect(r.unknownSlots).toEqual(["X"]);
  });

  it("ignores lowercase $names and $ preceded by an identifier char", () => {
    const r = analyzeReferences("price is $cost and A$B", new Set(), new Set());
    expect([...r.slots]).toEqual([]);
  });
});
