import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDockerClient } from "./docker-client.ts";
import { wrapDockerfile } from "./dockerfile-wrap.ts";

export interface BuildDockerfileImageDeps {
  content: string;
  client: IDockerClient;
  bundleRef: string;
  tagPrefix?: string;
}

/** Build (or reuse) an image from a user Dockerfile, auto-wrapped with the runner bundle. */
export async function buildDockerfileImage(deps: BuildDockerfileImageDeps): Promise<string> {
  const effective = wrapDockerfile(deps.content, deps.bundleRef);
  const hash = createHash("sha256").update(effective).digest("hex").slice(0, 16);
  const tag = `${deps.tagPrefix ?? "journeyman/jm-built"}:${hash}`;

  if (await deps.client.imageExists(tag)) return tag;

  const dir = await mkdtemp(join(tmpdir(), "jm-build-"));
  try {
    await writeFile(join(dir, "Dockerfile"), effective, "utf8");
    await deps.client.buildImage({ contextDir: dir, dockerfileName: "Dockerfile", tag });
    return tag;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
