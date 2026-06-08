import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IDockerClient } from "./docker-client.ts";
import { type ImageConfig } from "./recipe.ts";
import { resolveBuildInputs } from "./resolve-build-inputs.ts";

export interface BuildBoxImageDeps {
  image: ImageConfig;
  client: IDockerClient;
  bundleRef: string;
  tagPrefix?: string;
}

export interface BuildBoxImageResult {
  imageRef: string;
  fingerprint: string;
}

/**
 * Build (or reuse) a sandbox's box image: the user's ref/dockerfile,
 * auto-wrapped with the runner kit. Throws if the image is empty (the caller
 * should fall back to the default box instead of building).
 */
export async function buildBoxImage(deps: BuildBoxImageDeps): Promise<BuildBoxImageResult> {
  const inputs = await resolveBuildInputs({
    image: deps.image,
    client: deps.client,
    bundleRef: deps.bundleRef,
    ...(deps.tagPrefix ? { tagPrefix: deps.tagPrefix } : {}),
  });

  if (await deps.client.imageExists(inputs.imageRef)) {
    return { imageRef: inputs.imageRef, fingerprint: inputs.fingerprint };
  }

  const dir = await mkdtemp(join(tmpdir(), "jm-build-"));
  try {
    await writeFile(join(dir, "Dockerfile"), inputs.effectiveRecipe, "utf8");
    await deps.client.buildImage({
      contextDir: dir,
      dockerfileName: "Dockerfile",
      tag: inputs.imageRef,
      ...(inputs.dockerfilePull ? { pull: true } : {}),
    });
    // Guard against a silent build failure: the image must actually exist now,
    // otherwise we'd commit a 'ready' status pointing at a non-existent tag.
    if (!(await deps.client.imageExists(inputs.imageRef))) {
      throw new Error(`build reported success but image ${inputs.imageRef} is absent`);
    }
    return { imageRef: inputs.imageRef, fingerprint: inputs.fingerprint };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** @deprecated dockerfile-only shim retained for compatibility; prefer buildBoxImage. */
export async function buildDockerfileImage(deps: {
  content: string; client: IDockerClient; bundleRef: string; tagPrefix?: string;
}): Promise<string> {
  const { imageRef } = await buildBoxImage({
    image: { kind: "dockerfile", content: deps.content },
    client: deps.client, bundleRef: deps.bundleRef,
    ...(deps.tagPrefix ? { tagPrefix: deps.tagPrefix } : {}),
  });
  return imageRef;
}
