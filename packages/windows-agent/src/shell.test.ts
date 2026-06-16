import { describe, it, expect } from "vitest";
import { findGitBash } from "./shell.ts";

describe("findGitBash", () => {
  it("returns the first candidate that exists", () => {
    const found = findGitBash({ candidates: [process.execPath, "C:\\nope\\bash.exe"] });
    expect(found).toBe(process.execPath);
  });

  it("returns null when no candidate exists", () => {
    expect(findGitBash({ candidates: ["C:\\nope\\bash.exe", "/nope/bash"] })).toBeNull();
  });
});
