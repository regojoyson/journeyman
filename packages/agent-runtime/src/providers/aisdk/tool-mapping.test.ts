import { describe, it, expect } from "vitest";
import { AISDK_TOOL_MAP, aiSdkToolIds } from "./tool-mapping.ts";

describe("aiSdkToolIds", () => {
  it("maps canonical tools to native ids", () => {
    expect(aiSdkToolIds(["bash"])).toEqual(["bash"]);
    expect(aiSdkToolIds(["read-file", "write-file", "edit-file"])).toEqual(["read", "write", "edit"]);
    expect(aiSdkToolIds(["search"])).toEqual(["search"]);
    expect(aiSdkToolIds(["web-fetch"])).toEqual(["web_fetch"]);
  });
  it("dedupes and skips unsupported (web-search)", () => {
    expect(aiSdkToolIds(["search", "search"])).toEqual(["search"]);
    expect(aiSdkToolIds(["web-search"])).toEqual([]);
  });
  it("returns [] for a pure-prompt step", () => {
    expect(aiSdkToolIds([])).toEqual([]);
  });
  it("web-search maps to null in the map", () => {
    expect(AISDK_TOOL_MAP["web-search"]).toBeNull();
  });
});
