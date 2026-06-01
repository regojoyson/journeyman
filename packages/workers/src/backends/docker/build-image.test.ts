import { describe, it, expect } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { buildDockerfileImage } from "./build-image.ts";

function fakeClient(exists: boolean): { client: IDockerClient; built: string[] } {
  const built: string[] = [];
  const client = {
    async imageExists() { return exists; },
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
});
