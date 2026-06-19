import { describe, it, expect } from "vitest";
import {
  insertSkillPackage,
  listSkillPackages,
  fetchSkillPackagesByIds,
  listSkillPackagesForResolver,
} from "./db.ts";

type Call = { text: string; params?: unknown[] };
function fakeDb(rows: any[] = []) {
  const calls: Call[] = [];
  const db: any = { calls, async query(text: string, params?: unknown[]) { calls.push({ text, params }); return { rows }; } };
  return db;
}
const ROW = {
  id: "s1", workspace_id: "w1", git_url: "https://x/y.git", name: "pkg",
  local_path: null, commit_sha: null, install_status: "ready", install_error: null,
  enabled_skills: [], cli_type: "claude", created_at: "2026-06-19", updated_at: "2026-06-19",
};

describe("skills db (workspace scope)", () => {
  it("insertSkillPackage writes workspace_id and maps record", async () => {
    const db = fakeDb([ROW]);
    const rec = await insertSkillPackage(db, { workspaceId: "w1", gitUrl: "https://x/y.git", name: "pkg" });
    expect(rec.workspaceId).toBe("w1");
    expect(db.calls[0].text).toMatch(/insert into jm_skill_packages \(workspace_id/i);
    expect(db.calls[0].params?.[0]).toBe("w1");
  });

  it("listSkillPackages filters by workspace_id only", async () => {
    const db = fakeDb([ROW]);
    await listSkillPackages(db, "w1");
    expect(db.calls[0].text).toMatch(/where workspace_id = \$1/i);
    expect(db.calls[0].text).not.toMatch(/user_id|org_id|scope/i);
    expect(db.calls[0].params).toEqual(["w1"]);
  });

  it("listSkillPackagesForResolver filters workspace + cli + ready", async () => {
    const db = fakeDb([ROW]);
    await listSkillPackagesForResolver(db, "w1", "claude");
    expect(db.calls[0].text).toMatch(/workspace_id = \$1 and cli_type = \$2 and install_status = 'ready'/i);
    expect(db.calls[0].params).toEqual(["w1", "claude"]);
  });

  it("fetchSkillPackagesByIds scopes by workspace + id set", async () => {
    const db = fakeDb([ROW]);
    await fetchSkillPackagesByIds(db, "w1", ["s1"]);
    expect(db.calls[0].text).toMatch(/workspace_id = \$1 and id = any/i);
    expect(db.calls[0].params).toEqual(["w1", ["s1"]]);
  });
});
