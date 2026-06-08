import { describe, it, expect } from "vitest";
import { tokenRanges, TOKEN_CLASS } from "./token-ranges.ts";

describe("tokenRanges", () => {
  it("marks known inputs and flags unknown ones", () => {
    const r = tokenRanges("{{a}} {{b}}", new Set(["a"]), new Set());
    expect(r).toEqual([
      { from: 0, to: 5, cls: TOKEN_CLASS.input },
      { from: 6, to: 11, cls: TOKEN_CLASS.unknown },
    ]);
  });

  it("excludes the leading char from a $slot range", () => {
    const r = tokenRanges("x $TOK", new Set(), new Set(["TOK"]));
    expect(r).toEqual([{ from: 2, to: 6, cls: TOKEN_CLASS.slot }]);
  });

  it("returns ranges sorted by start offset", () => {
    const r = tokenRanges("$A {{b}}", new Set(["b"]), new Set(["A"]));
    expect(r.map(x => x.from)).toEqual([0, 3]);
  });
});
