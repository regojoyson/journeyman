import { describe, it, expect } from "vitest";
import { parseRequestCwd } from "./cli.ts";

describe("parseRequestCwd", () => {
  it("returns opts.cwd when present", () => {
    expect(parseRequestCwd(JSON.stringify({ op: "custom-prompt", opts: { cwd: "/workspace" } }))).toBe("/workspace");
  });
  it("returns undefined when opts.cwd is missing", () => {
    expect(parseRequestCwd(JSON.stringify({ op: "custom-prompt", opts: {} }))).toBeUndefined();
    expect(parseRequestCwd(JSON.stringify({ op: "custom-prompt" }))).toBeUndefined();
  });
  it("returns undefined for an empty-string or non-string cwd", () => {
    expect(parseRequestCwd(JSON.stringify({ opts: { cwd: "" } }))).toBeUndefined();
    expect(parseRequestCwd(JSON.stringify({ opts: { cwd: 5 } }))).toBeUndefined();
  });
  it("returns undefined for invalid JSON (handled downstream)", () => {
    expect(parseRequestCwd("not json")).toBeUndefined();
  });
});
