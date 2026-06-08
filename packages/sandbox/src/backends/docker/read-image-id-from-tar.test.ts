import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as tarCreate } from "tar";
import { readImageIdFromTar } from "./read-image-id-from-tar.ts";

let dir = "";
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "tarid-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

/** Build a minimal docker-save-shaped tar with the given manifest.json contents. */
async function makeTar(manifest: unknown): Promise<string> {
  const stage = join(dir, "stage");
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest), "utf8");
  await writeFile(join(stage, "layer.bin"), "x".repeat(1024), "utf8");
  const tarPath = join(dir, "img.tar");
  await tarCreate({ file: tarPath, cwd: stage }, ["layer.bin", "manifest.json"]);
  return tarPath;
}

describe("readImageIdFromTar", () => {
  it("reads the legacy Config '<hex>.json' as sha256:<hex>", async () => {
    const tarPath = await makeTar([{ Config: "abc123.json", RepoTags: ["x:dev"], Layers: [] }]);
    expect(await readImageIdFromTar(tarPath)).toBe("sha256:abc123");
  });

  it("normalizes an OCI 'blobs/sha256/<hex>' Config", async () => {
    const tarPath = await makeTar([{ Config: "blobs/sha256/deadbeef", RepoTags: ["x:dev"] }]);
    expect(await readImageIdFromTar(tarPath)).toBe("sha256:deadbeef");
  });

  it("throws when manifest.json is missing", async () => {
    const stage = join(dir, "empty");
    await mkdir(stage, { recursive: true });
    await writeFile(join(stage, "only.bin"), "z", "utf8");
    const tarPath = join(dir, "bad.tar");
    await tarCreate({ file: tarPath, cwd: stage }, ["only.bin"]);
    await expect(readImageIdFromTar(tarPath)).rejects.toThrow(/no manifest\.json/);
  });

  it("throws when manifest has no Config", async () => {
    const tarPath = await makeTar([{ RepoTags: ["x:dev"] }]);
    await expect(readImageIdFromTar(tarPath)).rejects.toThrow(/no Config/);
  });
});
