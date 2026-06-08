import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureKitImage } from "./ensure-kit.ts";

let dir = "";
let tarPath = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kit-"));
  tarPath = join(dir, "runner-bundle.tar");
  await writeFile(tarPath, "fake-tar", "utf8");
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function client(over: Partial<any> = {}) {
  return {
    imageExists: vi.fn().mockResolvedValue(false),
    loadImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("ensureKitImage", () => {
  it("does nothing when the image is already present", async () => {
    const c = client({ imageExists: vi.fn().mockResolvedValue(true) });
    await ensureKitImage(c as any, "journeyman/runner-bundle:dev", tarPath);
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("loads the tar when the image is missing, then re-checks presence", async () => {
    const exists = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const c = client({ imageExists: exists });
    await ensureKitImage(c as any, "journeyman/runner-bundle:dev", tarPath);
    expect(c.loadImage).toHaveBeenCalledWith(tarPath);
  });

  it("throws a clear error when image AND tar are both missing", async () => {
    const c = client();
    await expect(ensureKitImage(c as any, "journeyman/runner-bundle:dev", join(dir, "nope.tar")))
      .rejects.toThrow(/run 'npm run build:kit'/);
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("throws if load 'succeeds' but the image is still absent", async () => {
    const c = client({ imageExists: vi.fn().mockResolvedValue(false) });
    await expect(ensureKitImage(c as any, "journeyman/runner-bundle:dev", tarPath))
      .rejects.toThrow(/still absent/);
  });
});
