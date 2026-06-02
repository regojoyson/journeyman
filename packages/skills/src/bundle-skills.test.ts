import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleEnabledSkills } from "./bundle-skills.ts";

describe("bundleEnabledSkills", () => {
  it("packs each package dir and returns an in-container mapping", () => {
    const root = mkdtempSync(join(tmpdir(), "pkg-"));
    mkdirSync(join(root, "skills", "alpha"), { recursive: true });
    writeFileSync(join(root, "skills", "alpha", "SKILL.md"), "# alpha");
    const { bundle, mapping } = bundleEnabledSkills(
      [{ id: "p1", name: "pkg", localPath: root, enabledSkills: ["alpha"], gitUrl: "", cliType: "claude" } as any],
      "/workspace/.journeyman/skills",
    );
    expect(bundle.tar).toBeDefined();
    expect(mapping).toEqual([{ id: "p1", containerPath: `/workspace/.journeyman/skills/${root.split("/").pop()}` }]);
  });
});
