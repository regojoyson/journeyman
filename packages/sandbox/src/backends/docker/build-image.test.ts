import { describe, it, expect } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { buildDockerfileImage, buildBoxImage } from "./build-image.ts";

function fakeClient(exists: boolean, bundleId = "sha256:bundle"): { client: IDockerClient; built: string[] } {
  const built: string[] = [];
  const client = {
    // True if pre-existing (cache) OR we just built that tag (real docker behavior).
    async imageExists(tag: string) { return exists || built.includes(tag); },
    async imageId() { return bundleId; },
    async pullImage() { /* no-op in tests */ },
    async buildImage(o: { tag: string }) { built.push(o.tag); },
  } as unknown as IDockerClient;
  return { client, built };
}

describe("buildDockerfileImage", () => {
  it("returns the cached tag without building when the image exists", async () => {
    const { client, built } = fakeClient(true);
    const ref = await buildDockerfileImage({ content: "FROM x", client, bundleRef: "b:dev" });
    expect(ref).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(built).toEqual([]);
  });

  it("builds and tags when the image is absent", async () => {
    const { client, built } = fakeClient(false);
    const ref = await buildDockerfileImage({ content: "FROM x", client, bundleRef: "b:dev" });
    expect(built).toEqual([ref]);
  });

  it("is deterministic: same content+bundle ⇒ same tag, different ⇒ different", async () => {
    const a = await buildDockerfileImage({ content: "FROM x", client: fakeClient(true).client, bundleRef: "b:dev" });
    const b = await buildDockerfileImage({ content: "FROM x", client: fakeClient(true).client, bundleRef: "b:dev" });
    const c = await buildDockerfileImage({ content: "FROM y", client: fakeClient(true).client, bundleRef: "b:dev" });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it("rebuilds when the bundle digest changes even if the Dockerfile text is identical", async () => {
    const old = await buildDockerfileImage({ content: "FROM x", client: fakeClient(true, "sha256:OLD").client, bundleRef: "b:dev" });
    const fresh = await buildDockerfileImage({ content: "FROM x", client: fakeClient(true, "sha256:NEW").client, bundleRef: "b:dev" });
    expect(fresh).not.toBe(old);
  });
});

describe("buildBoxImage", () => {
  it("reuses a cached image without building", async () => {
    const { client, built } = fakeClient(true);
    const r = await buildBoxImage({
      image: { kind: "ref", imageRef: "node:20" },
      client, bundleRef: "journeyman/runner-bundle:dev",
    });
    expect(r.imageRef).toMatch(/^journeyman\/jm-built:[0-9a-f]{16}$/);
    expect(r.fingerprint).toHaveLength(16);
    expect(built).toEqual([]);
  });

  it("builds when the image is absent", async () => {
    const { client, built } = fakeClient(false);
    const r = await buildBoxImage({
      image: { kind: "dockerfile", content: "FROM python:3.12\n" },
      client, bundleRef: "journeyman/runner-bundle:dev",
    });
    expect(built).toEqual([r.imageRef]);
  });

  it("throws for an empty image (caller must use the default box)", async () => {
    const { client } = fakeClient(false);
    await expect(buildBoxImage({ image: undefined, client, bundleRef: "b" }))
      .rejects.toThrow(/no image recipe/i);
  });

  it("throws if the build silently 'succeeds' but no image exists", async () => {
    // Simulate dockerode's pitfall: buildImage resolves but tags nothing.
    const client = {
      async imageExists() { return false; },      // never present, even after build
      async imageId() { return "sha256:bundle"; },
      async pullImage() { /* no-op in tests */ },
      async buildImage() { /* no-op: pretends success without tagging */ },
    } as unknown as IDockerClient;
    await expect(buildBoxImage({
      image: { kind: "ref", imageRef: "node:20" }, client, bundleRef: "journeyman/runner-bundle:dev",
    })).rejects.toThrow(/image .* is absent/i);
  });
});
