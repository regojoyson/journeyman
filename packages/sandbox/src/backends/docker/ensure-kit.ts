import type { IDockerClient } from "./docker-client.ts";
import type { RegistryAuth } from "./registry-auth.ts";

/**
 * Ensure a digest-pinned kit image is present on the daemon. Because the ref is
 * pinned by digest (`<repo>@sha256:…`), presence is sufficient — pull only when
 * absent, never compare ids, never load tars.
 */
export async function ensureKitImage(
  client: IDockerClient,
  ref: string,
  auth?: RegistryAuth,
  log: (line: string) => void = () => {},
): Promise<void> {
  if (await client.imageExists(ref)) return;
  log(`pulling kit image ${ref}`);
  await client.pullImage(ref, auth);
}
