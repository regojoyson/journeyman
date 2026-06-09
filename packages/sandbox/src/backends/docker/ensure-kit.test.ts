import { describe, it, expect, vi } from "vitest";
import { ensureKitImage } from "./ensure-kit.ts";

function client(present: boolean) {
  return {
    imageExists: vi.fn().mockResolvedValue(present),
    pullImage: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ensureKitImage", () => {
  it("pulls when the image is absent", async () => {
    const c = client(false);
    await ensureKitImage(c as any, "reg/runner-base@sha256:abc");
    expect(c.pullImage).toHaveBeenCalledWith("reg/runner-base@sha256:abc", undefined);
  });

  it("skips the pull when the image is already present (digest-pinned)", async () => {
    const c = client(true);
    await ensureKitImage(c as any, "reg/runner-base@sha256:abc");
    expect(c.pullImage).not.toHaveBeenCalled();
  });

  it("passes auth through to the pull", async () => {
    const c = client(false);
    const auth = { username: "u", password: "p", serveraddress: "reg" };
    await ensureKitImage(c as any, "reg/x@sha256:1", auth as any);
    expect(c.pullImage).toHaveBeenCalledWith("reg/x@sha256:1", auth);
  });
});
