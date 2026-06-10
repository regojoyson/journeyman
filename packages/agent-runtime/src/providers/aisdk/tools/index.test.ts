import { describe, it, expect } from "vitest";
import { buildBuiltinTools } from "./index.ts";

describe("buildBuiltinTools", () => {
  it("includes only the requested native tool ids", () => {
    const tools = buildBuiltinTools(["bash", "read"], { cwd: "/tmp" });
    expect(Object.keys(tools).sort()).toEqual(["bash", "read"]);
  });
  it("returns {} for a pure-prompt step", () => {
    expect(buildBuiltinTools([], {})).toEqual({});
  });
  it("maps web_fetch id to the web-fetch tool", () => {
    const tools = buildBuiltinTools(["web_fetch"], {});
    expect(Object.keys(tools)).toEqual(["web_fetch"]);
  });
});
