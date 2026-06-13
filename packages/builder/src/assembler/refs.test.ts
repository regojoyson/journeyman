import { describe, it, expect } from "vitest";
import { refString, toInputValue, isValidNodeId } from "./refs.ts";
import type { InputIntent } from "./intent.ts";

describe("refString", () => {
  it("builds a step-output ref", () => {
    expect(refString({ from: "step-output", stepRef: "n_2", field: "diff" })).toBe("n_2.output.diff");
  });
  it("builds workflow-input and attribute refs", () => {
    expect(refString({ from: "workflow-input", name: "repo" })).toBe("workflow.input.repo");
    expect(refString({ from: "workflow-attribute", name: "baseUrl" })).toBe("workflow.attribute.baseUrl");
  });
  it("returns null for kinds that are not single refs", () => {
    expect(refString({ from: "literal", value: 1 })).toBeNull();
    expect(refString({ from: "template", template: "x" })).toBeNull();
  });
});

describe("toInputValue", () => {
  it("maps literal", () => {
    expect(toInputValue({ from: "literal", value: 42 })).toEqual({ kind: "literal", value: 42 });
  });
  it("maps a single ref", () => {
    const v: InputIntent = { from: "step-output", stepRef: "a", field: "out" };
    expect(toInputValue(v)).toEqual({ kind: "ref", ref: "a.output.out" });
  });
  it("maps a template verbatim (refs already embedded as {{ }})", () => {
    expect(toInputValue({ from: "template", template: "Fix {{ workflow.input.key }}" }))
      .toEqual({ kind: "template", template: "Fix {{ workflow.input.key }}" });
  });
});

describe("isValidNodeId", () => {
  it("accepts ids without dots", () => {
    expect(isValidNodeId("n_1")).toBe(true);
    expect(isValidNodeId("get-ticket")).toBe(true);
  });
  it("rejects ids containing a dot (would break ref parsing)", () => {
    expect(isValidNodeId("a.b")).toBe(false);
  });
});
