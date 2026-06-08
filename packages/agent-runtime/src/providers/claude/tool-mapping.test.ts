import { describe, it, expect } from "vitest";
import { CANONICAL_TOOLS } from "@journeyman/core";
import { CLAUDE_TOOL_MAP, claudeNativeTools } from "./tool-mapping.ts";

describe("claudeNativeTools", () => {
  it("maps each canonical tool to its native Claude tool name(s)", () => {
    expect(claudeNativeTools(["bash"])).toEqual(["Bash"]);
    expect(claudeNativeTools(["read-file"])).toEqual(["Read"]);
    expect(claudeNativeTools(["write-file"])).toEqual(["Write"]);
    expect(claudeNativeTools(["edit-file"])).toEqual(["Edit"]);
    expect(claudeNativeTools(["search"])).toEqual(["Grep", "Glob"]);
    expect(claudeNativeTools(["web-fetch"])).toEqual(["WebFetch"]);
    expect(claudeNativeTools(["web-search"])).toEqual(["WebSearch"]);
  });

  it("expands multi-tool canonical entries (search → Grep + Glob)", () => {
    expect(claudeNativeTools(["bash", "search"])).toEqual(["Bash", "Grep", "Glob"]);
  });

  it("returns an empty array for no tools (pure-prompt step)", () => {
    expect(claudeNativeTools([])).toEqual([]);
  });

  it("de-duplicates overlapping native names", () => {
    // "search" appears twice → Grep/Glob must not be repeated.
    expect(claudeNativeTools(["search", "search"])).toEqual(["Grep", "Glob"]);
  });

  it("skips unknown canonical tools rather than emitting undefined", () => {
    expect(claudeNativeTools(["bash", "not-a-tool" as never])).toEqual(["Bash"]);
  });

  // Regression guard: a new canonical tool added to core without a Claude
  // mapping would silently never reach the SDK. This forces the map to stay
  // complete.
  it("has a mapping for every canonical tool", () => {
    for (const t of CANONICAL_TOOLS) {
      expect(CLAUDE_TOOL_MAP[t], `missing CLAUDE_TOOL_MAP entry for '${t}'`).toBeDefined();
      expect(CLAUDE_TOOL_MAP[t].length).toBeGreaterThan(0);
    }
  });

  it("maps the full canonical set without losing any tool", () => {
    const native = claudeNativeTools(CANONICAL_TOOLS);
    expect(native).toEqual(["Bash", "Read", "Write", "Edit", "Grep", "Glob", "WebFetch", "WebSearch"]);
  });
});
