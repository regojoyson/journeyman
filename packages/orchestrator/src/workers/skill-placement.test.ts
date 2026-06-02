import { describe, it, expect, vi } from "vitest";
import { placeSkills } from "./skill-placement.ts";

describe("placeSkills (claude)", () => {
  it("materializes package dirs and rewrites localPath to the container path", async () => {
    const materialize = vi.fn().mockResolvedValue(undefined);
    const skills = [{ id: "p1", name: "pkg", localPath: "/home/.journeyman/skills/pkg-ab12", enabledSkills: ["alpha"], gitUrl: "", cliType: "claude" }] as any;
    const rewritten = await placeSkills("claude", skills, { materialize });
    expect(materialize).toHaveBeenCalledWith("/workspace/.journeyman/skills", expect.anything());
    expect(rewritten[0].localPath).toBe("/workspace/.journeyman/skills/pkg-ab12");
  });
  it("is a no-op when there are no skills", async () => {
    const materialize = vi.fn();
    const rewritten = await placeSkills("claude", [], { materialize });
    expect(materialize).not.toHaveBeenCalled();
    expect(rewritten).toEqual([]);
  });
});
