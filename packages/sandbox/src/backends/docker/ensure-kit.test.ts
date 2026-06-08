import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileKitImage } from "./ensure-kit.ts";

// readImageIdFromTar is exercised in its own test; stub it here so we drive
// reconcile logic with plain values rather than building real tars.
vi.mock("./read-image-id-from-tar.ts", () => ({
  readImageIdFromTar: vi.fn(async () => "sha256:TAR"),
}));

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
    imageId: vi.fn().mockResolvedValue(null),
    loadImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const NAME = "journeyman/runner-bundle:dev";

describe("reconcileKitImage", () => {
  it("skips loading when the loaded image id already matches the tar", async () => {
    const c = client({ imageId: vi.fn().mockResolvedValue("sha256:TAR") });
    await reconcileKitImage(c as any, NAME, tarPath);
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("loads the tar when the loaded image id differs (stale)", async () => {
    const imageId = vi.fn()
      .mockResolvedValueOnce("sha256:OLD")  // before load
      .mockResolvedValueOnce("sha256:TAR"); // after load
    const c = client({ imageId });
    await reconcileKitImage(c as any, NAME, tarPath);
    expect(c.loadImage).toHaveBeenCalledWith(tarPath);
  });

  it("loads the tar when the image is absent", async () => {
    const imageId = vi.fn()
      .mockResolvedValueOnce(null)          // absent
      .mockResolvedValueOnce("sha256:TAR"); // after load
    const c = client({ imageId });
    await reconcileKitImage(c as any, NAME, tarPath);
    expect(c.loadImage).toHaveBeenCalledWith(tarPath);
  });

  it("keeps the existing image when present and no tar is on disk", async () => {
    const c = client({ imageId: vi.fn().mockResolvedValue("sha256:OLD") });
    await reconcileKitImage(c as any, NAME, join(dir, "missing.tar"));
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("throws a clear error when image AND tar are both missing", async () => {
    const c = client({ imageId: vi.fn().mockResolvedValue(null) });
    await expect(reconcileKitImage(c as any, NAME, join(dir, "missing.tar")))
      .rejects.toThrow(/run 'npm run build:kit'/);
    expect(c.loadImage).not.toHaveBeenCalled();
  });

  it("throws when the load did not produce the expected image id", async () => {
    const imageId = vi.fn()
      .mockResolvedValueOnce("sha256:OLD")  // before
      .mockResolvedValueOnce("sha256:OLD"); // after — load didn't take
    const c = client({ imageId });
    await expect(reconcileKitImage(c as any, NAME, tarPath))
      .rejects.toThrow(/expected sha256:TAR/);
  });
});
