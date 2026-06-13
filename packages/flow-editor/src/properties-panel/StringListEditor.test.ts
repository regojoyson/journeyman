import { describe, it, expect } from "vitest";
import { splitRows, joinRows } from "./StringListEditor.tsx";

describe("splitRows", () => {
  it("empty string → one blank row", () => {
    expect(splitRows("")).toEqual([""]);
    expect(splitRows(undefined)).toEqual([""]);
  });
  it("splits on newlines", () => {
    expect(splitRows("a\nb")).toEqual(["a", "b"]);
    expect(splitRows("a")).toEqual(["a"]);
  });
});

describe("joinRows", () => {
  it("trims, drops blank rows, joins with newline", () => {
    expect(joinRows(["a", "", "b "])).toBe("a\nb");
    expect(joinRows(["  ", "x"])).toBe("x");
  });
  it("all-blank → empty string", () => {
    expect(joinRows(["", ""])).toBe("");
    expect(joinRows([])).toBe("");
  });
});
