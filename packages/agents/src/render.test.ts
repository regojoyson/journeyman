import { describe, it, expect } from "vitest";
import { renderInstructions } from "./render.ts";

describe("renderInstructions", () => {
  it("substitutes named inputs", () => {
    expect(
      renderInstructions("Fix {{ticketKey}} now", { inputs: { ticketKey: "PROJ-1" }, triggerType: "manual" }),
    ).toBe("Fix PROJ-1 now");
  });
  it("leaves a missing input as an empty string", () => {
    expect(renderInstructions("Fix {{ticketKey}}!", { inputs: {}, triggerType: "manual" })).toBe("Fix !");
  });
  it("renders {{payload}} as JSON and {{trigger.type}} as the source", () => {
    const out = renderInstructions("p={{payload}} t={{trigger.type}}", {
      inputs: {},
      payload: { a: 1 },
      triggerType: "webhook",
    });
    expect(out).toBe('p={"a":1} t=webhook');
  });
  it("renders {{payload}} as {} when no payload is supplied", () => {
    expect(renderInstructions("{{payload}}", { inputs: {}, triggerType: "schedule" })).toBe("{}");
  });
  it("substitutes every occurrence of a repeated token", () => {
    expect(renderInstructions("{{k}}-{{k}}", { inputs: { k: "x" }, triggerType: "api" })).toBe("x-x");
  });
  it("coerces non-string input values", () => {
    expect(renderInstructions("n={{n}} b={{b}}", { inputs: { n: 5, b: true }, triggerType: "manual" })).toBe(
      "n=5 b=true",
    );
  });
});
