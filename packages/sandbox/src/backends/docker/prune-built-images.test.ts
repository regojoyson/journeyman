import { describe, it, expect, vi } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { pruneBuiltImages } from "./prune-built-images.ts";

function client(tags: string[], over: Partial<any> = {}) {
  return {
    listImageTags: vi.fn().mockResolvedValue(tags),
    removeImage: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as IDockerClient & { listImageTags: any; removeImage: any };
}

describe("pruneBuiltImages", () => {
  it("removes jm-built tags not in the keep set", async () => {
    const c = client([
      "journeyman/jm-built:keep1",
      "journeyman/jm-built:old1",
      "journeyman/jm-built:old2",
      "node:20", // not a jm-built tag — never touched
    ]);
    const removed = await pruneBuiltImages(c as any, new Set(["journeyman/jm-built:keep1"]));
    expect(removed).toEqual(["journeyman/jm-built:old1", "journeyman/jm-built:old2"]);
    expect(c.removeImage).toHaveBeenCalledTimes(2);
    expect(c.removeImage).not.toHaveBeenCalledWith("node:20");
  });

  it("never removes a kept image and ignores non-jm-built tags", async () => {
    const c = client(["journeyman/jm-built:keep1", "journeyman/runner-base:dev"]);
    const removed = await pruneBuiltImages(c as any, new Set(["journeyman/jm-built:keep1"]));
    expect(removed).toEqual([]);
    expect(c.removeImage).not.toHaveBeenCalled();
  });

  it("swallows per-image removal errors (image in use) and continues", async () => {
    const removeImage = vi.fn()
      .mockRejectedValueOnce(new Error("in use"))
      .mockResolvedValueOnce(undefined);
    const c = client(["journeyman/jm-built:a", "journeyman/jm-built:b"], { removeImage });
    const removed = await pruneBuiltImages(c as any, new Set());
    expect(removed).toEqual(["journeyman/jm-built:b"]);
  });
});
