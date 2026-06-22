import { describe, it, expect } from "vitest";
import { toRepoEntries } from "./to-repo-entries.ts";

describe("toRepoEntries", () => {
  it("maps {url,branch}[] preserving per-repo branch", () => {
    expect(toRepoEntries([{ url: "acme/api", branch: "develop" }, { url: "acme/web", branch: "" }]))
      .toEqual([{ url: "acme/api", branch: "develop" }, { url: "acme/web", branch: "" }]);
  });

  it("defaults a missing/blank branch to empty string", () => {
    expect(toRepoEntries([{ url: "acme/api" }])).toEqual([{ url: "acme/api", branch: "" }]);
  });

  it("drops entries with empty url and trims", () => {
    expect(toRepoEntries([{ url: "  acme/api  ", branch: " main " }, { url: "" }]))
      .toEqual([{ url: "acme/api", branch: "main" }]);
  });

  it("accepts a newline/comma string list with a fallback branch", () => {
    expect(toRepoEntries("acme/api\nacme/web", "qa"))
      .toEqual([{ url: "acme/api", branch: "qa" }, { url: "acme/web", branch: "qa" }]);
  });

  it("accepts string[]", () => {
    expect(toRepoEntries(["acme/api", "acme/web"])).toEqual([
      { url: "acme/api", branch: "" }, { url: "acme/web", branch: "" },
    ]);
  });

  it("returns [] for null/undefined/garbage", () => {
    expect(toRepoEntries(undefined)).toEqual([]);
    expect(toRepoEntries(null)).toEqual([]);
    expect(toRepoEntries(42 as unknown)).toEqual([]);
  });
});
