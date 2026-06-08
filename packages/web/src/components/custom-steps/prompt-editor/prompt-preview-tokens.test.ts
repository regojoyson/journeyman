import { describe, it, expect } from "vitest";
import { splitTokens } from "./prompt-preview-tokens.ts";

describe("splitTokens", () => {
  it("splits inputs and slots out of surrounding text", () => {
    expect(splitTokens("Review {{pr}} with $GH_TOKEN now")).toEqual([
      { kind: "text", value: "Review " },
      { kind: "input", name: "pr" },
      { kind: "text", value: " with " },
      { kind: "slot", name: "GH_TOKEN" },
      { kind: "text", value: " now" },
    ]);
  });

  it("returns a single text segment when there are no tokens", () => {
    expect(splitTokens("plain text")).toEqual([{ kind: "text", value: "plain text" }]);
  });

  it("does not match $ following an identifier char", () => {
    expect(splitTokens("A$B")).toEqual([{ kind: "text", value: "A$B" }]);
  });
});
