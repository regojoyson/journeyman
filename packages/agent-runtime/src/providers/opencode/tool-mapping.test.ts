import { describe, it, expect } from "vitest";
import { CANONICAL_TOOLS } from "@journeyman/core";
import { OPENCODE_TOOL_MAP, openCodeToolsEnableMap } from "./tool-mapping.ts";

describe("openCodeToolsEnableMap", () => {
  it("maps canonical tools to an OpenCode enable map", () => {
    expect(openCodeToolsEnableMap(["bash"])).toEqual({ bash: true });
    expect(openCodeToolsEnableMap(["read-file"])).toEqual({ read: true });
    expect(openCodeToolsEnableMap(["write-file"])).toEqual({ write: true });
    expect(openCodeToolsEnableMap(["edit-file"])).toEqual({ edit: true });
    expect(openCodeToolsEnableMap(["search"])).toEqual({ grep: true, glob: true });
    expect(openCodeToolsEnableMap(["web-fetch"])).toEqual({ webfetch: true });
  });

  it("merges multiple canonical tools into one enable map", () => {
    expect(openCodeToolsEnableMap(["bash", "search"])).toEqual({ bash: true, grep: true, glob: true });
  });

  it("returns an empty map for no tools (pure-prompt step)", () => {
    expect(openCodeToolsEnableMap([])).toEqual({});
  });

  it("skips canonical tools with no OpenCode equivalent (web-search)", () => {
    expect(openCodeToolsEnableMap(["web-search"])).toEqual({});
  });

  it("has an explicit entry for every canonical tool (null allowed for unsupported)", () => {
    for (const t of CANONICAL_TOOLS) {
      expect(Object.prototype.hasOwnProperty.call(OPENCODE_TOOL_MAP, t), `missing OPENCODE_TOOL_MAP entry for '${t}'`).toBe(true);
    }
    expect(OPENCODE_TOOL_MAP["web-search"]).toBeNull();
  });
});
