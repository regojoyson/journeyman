import { describe, it, expect } from "vitest";
import { detectInputs } from "./detect-inputs.ts";

describe("detectInputs", () => {
  it("finds tokens in first-appearance order", () => {
    expect(detectInputs("Fix {{ticketKey}} in {{repo}}")).toEqual(["ticketKey", "repo"]);
  });
  it("deduplicates repeated tokens", () => {
    expect(detectInputs("{{a}} and {{a}} and {{b}}")).toEqual(["a", "b"]);
  });
  it("excludes the reserved payload token", () => {
    expect(detectInputs("see {{payload}} and {{x}}")).toEqual(["x"]);
  });
  it("does not match dotted reserved tokens like trigger.type", () => {
    expect(detectInputs("from {{trigger.type}} with {{x}}")).toEqual(["x"]);
  });
  it("returns an empty array when there are no tokens", () => {
    expect(detectInputs("plain text")).toEqual([]);
  });
  it("tolerates inner whitespace", () => {
    expect(detectInputs("{{  spaced  }}")).toEqual(["spaced"]);
  });
});
