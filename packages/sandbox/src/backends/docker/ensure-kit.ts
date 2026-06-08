import { existsSync } from "node:fs";
import type { IDockerClient } from "./docker-client.ts";
import { readImageIdFromTar } from "./read-image-id-from-tar.ts";

/**
 * Ensure a kit image (e.g. journeyman/runner-bundle:dev) on the daemon is the
 * SAME image as the tar on disk. Loads the tar from `docker save` when the image
 * is absent OR its content id differs from the tar's — never pulls, never builds.
 *
 * This is the freshness fix: kit images use a fixed mutable tag (`:dev`), so an
 * existence-only check would keep a stale image forever. Comparing image ids
 * makes a rebuilt-and-re-saved tar actually replace the daemon image.
 */
export async function reconcileKitImage(
  client: IDockerClient,
  imageName: string,
  tarPath: string,
  log: (line: string) => void = () => {},
): Promise<void> {
  const loadedId = await client.imageId(imageName);
  const tarExists = existsSync(tarPath);

  if (!tarExists) {
    if (loadedId) return; // present, nothing to compare against — keep it
    throw new Error(
      `kit image '${imageName}' not found on the daemon and no tar at '${tarPath}' — run 'npm run build:kit'`,
    );
  }

  const tarId = await readImageIdFromTar(tarPath);
  if (loadedId === tarId) return; // up to date

  log(`loading kit image ${imageName} from ${tarPath} (was ${loadedId ?? "absent"}, tar ${tarId})`);
  await client.loadImage(tarPath);

  const after = await client.imageId(imageName);
  if (after !== tarId) {
    throw new Error(
      `loaded '${tarPath}' but '${imageName}' is ${after ?? "absent"} (expected ${tarId}; tar/arch mismatch?)`,
    );
  }
  log(`kit image ${imageName} loaded (${tarId})`);
}
