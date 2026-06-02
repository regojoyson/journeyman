import { describe, it, expect } from "vitest";
import { parseRepoList } from "./parse-repo-list.ts";

describe("parseRepoList", () => {
  it("strips a trailing newline", () => {
    expect(parseRepoList("https://github.com/x/HireIQ.git\n")).toEqual(["https://github.com/x/HireIQ.git"]);
  });
  it("splits multi-line input", () => {
    expect(parseRepoList("a\nb\nc")).toEqual(["a", "b", "c"]);
  });
  it("splits comma-separated input", () => {
    expect(parseRepoList("a, b ,c")).toEqual(["a", "b", "c"]);
  });
  it("handles mixed newlines and commas + blank lines + spaces", () => {
    expect(parseRepoList("  a , b \n\n c \n")).toEqual(["a", "b", "c"]);
  });
  it("handles a string[] whose elements may contain newlines", () => {
    expect(parseRepoList(["a\nb", " c "])).toEqual(["a", "b", "c"]);
  });
  it("returns [] for empty/undefined", () => {
    expect(parseRepoList("")).toEqual([]);
    expect(parseRepoList(undefined)).toEqual([]);
    expect(parseRepoList("  \n , \n ")).toEqual([]);
  });
});
