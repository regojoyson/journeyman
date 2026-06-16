import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionDir, destroyDir, listRuns, materializeTar } from "./workspace.ts";
import { create as tarCreate } from "tar";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "jm-agent-")); });

describe("workspace ops", () => {
  it("provision creates <root>/<runId> and list/destroy roundtrip", async () => {
    const p = await provisionDir(root, "run-1");
    expect(existsSync(p.workspaceDir)).toBe(true);
    expect(p.workspaceDir).toBe(join(root, "run-1"));
    expect((await listRuns(root)).map((r) => r.run_id)).toContain("run-1");
    await destroyDir(root, "run-1");
    expect(existsSync(p.workspaceDir)).toBe(false);
  });

  it("materialize clears then extracts a tar into a workspace-relative dest", async () => {
    await provisionDir(root, "run-2");
    const ws = join(root, "run-2");
    const srcDir = mkdtempSync(join(tmpdir(), "jm-src-"));
    writeFileSync(join(srcDir, "a.txt"), "hello");
    const chunks: Buffer[] = [];
    await new Promise<void>((res, rej) => {
      tarCreate({ cwd: srcDir }, ["a.txt"]).on("data", (c: Buffer) => chunks.push(c)).on("end", res).on("error", rej);
    });
    await materializeTar(ws, "/workspace/.staging", Buffer.concat(chunks));
    expect(existsSync(join(ws, ".staging", "a.txt"))).toBe(true);
  });

  it("destroy is idempotent (missing dir = ok)", async () => {
    await expect(destroyDir(root, "ghost")).resolves.toBeUndefined();
  });
});
