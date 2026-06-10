import { describe, it, expect } from "vitest";
import { extractPaths, findBashEscape } from "./extract-paths.ts";

describe("extractPaths", () => {
  it("pulls file_path for Read/Write/Edit", () => {
    expect(extractPaths("Read", { file_path: "/w/a.ts" })).toEqual(["/w/a.ts"]);
    expect(extractPaths("Write", { file_path: "/w/b.ts", content: "x" })).toEqual(["/w/b.ts"]);
    expect(extractPaths("Edit", { file_path: "/w/c.ts" })).toEqual(["/w/c.ts"]);
  });
  it("pulls path for Grep/Glob", () => {
    expect(extractPaths("Grep", { pattern: "foo", path: "/w/src" })).toEqual(["/w/src"]);
    expect(extractPaths("Glob", { pattern: "**/*.ts", path: "/w" })).toEqual(["/w"]);
  });
  it("returns [] when no path arg present (defaults to cwd)", () => {
    expect(extractPaths("Grep", { pattern: "foo" })).toEqual([]);
    expect(extractPaths("Bash", { command: "ls" })).toEqual([]);
    expect(extractPaths("WebFetch", { url: "https://x" })).toEqual([]);
  });
  it("tolerates non-object input", () => {
    expect(extractPaths("Read", undefined)).toEqual([]);
  });
});

describe("findBashEscape", () => {
  const root = "/workspace";
  it("allows commands operating inside root", () => {
    expect(findBashEscape("git -C /workspace/api status", root)).toBeNull();
    expect(findBashEscape("grep -rn foo src/", root)).toBeNull();
    expect(findBashEscape("date +%s", root)).toBeNull();
  });
  it("flags absolute paths outside root", () => {
    expect(findBashEscape("cat /etc/passwd", root)).toBe("/etc/passwd");
  });
  it("flags cd to a relative path escaping root", () => {
    expect(findBashEscape("cd ../../ && ls", root)).toBe("../../");
  });
});
