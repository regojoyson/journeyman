import { describe, it, expect } from "vitest";
import { CANONICAL_TOOLS } from "@journeyman/core";
import { OPENCODE_TOOL_MAP, openCodeToolsEnableMap, openCodeToolsConfig, OPENCODE_BUILTIN_TOOL_IDS } from "./tool-mapping.ts";

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

describe("openCodeToolsConfig", () => {
  it("empty list disables every builtin tool", () => {
    const cfg = openCodeToolsConfig([]);
    for (const id of OPENCODE_BUILTIN_TOOL_IDS) expect(cfg[id]).toBe(false);
  });

  it("selected tools are enabled, the rest disabled", () => {
    const cfg = openCodeToolsConfig(["read-file", "search"]);
    expect(cfg.read).toBe(true);
    expect(cfg.grep).toBe(true);
    expect(cfg.glob).toBe(true);
    expect(cfg.bash).toBe(false);
    expect(cfg.write).toBe(false);
    expect(cfg.edit).toBe(false);
    expect(cfg.webfetch).toBe(false);
  });

  it("never produces an empty map", () => {
    expect(Object.keys(openCodeToolsConfig([])).length).toBeGreaterThan(0);
  });
});
