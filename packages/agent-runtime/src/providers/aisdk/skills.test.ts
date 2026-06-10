import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillMenu, readSkillBody } from "./skills.ts";
import type { ResolvedSkillPackage } from "@journeyman/core";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aisdk-skills-"));
  mkdirSync(join(dir, "pdf"));
  writeFileSync(join(dir, "pdf", "SKILL.md"), "---\nname: pdf\ndescription: Work with PDFs\n---\nDo PDF things.");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const pkg = (): ResolvedSkillPackage => ({ id: "1", name: "docs", localPath: dir, enabledSkills: ["pdf"], cliType: "claude" });

describe("skills", () => {
  it("builds a menu listing enabled skills with descriptions", () => {
    const menu = buildSkillMenu([pkg()]);
    expect(menu).toContain("pdf");
    expect(menu).toContain("Work with PDFs");
  });
  it("reads a skill body by name", async () => {
    expect(await readSkillBody([pkg()], "pdf")).toContain("Do PDF things.");
  });
  it("returns a not-found message for an unknown skill", async () => {
    expect(await readSkillBody([pkg()], "nope")).toMatch(/not found/i);
  });
});
