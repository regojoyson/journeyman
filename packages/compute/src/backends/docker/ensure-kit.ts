import { existsSync } from "node:fs";
import type { IDockerClient } from "./docker-client.ts";

/**
 * Ensure a kit image (e.g. journeyman/runner-bundle:dev) is present on the daemon.
 * If missing, load it from a `docker save` tar — never pulls from a registry, never
 * builds. Throws a clear error if neither the image nor the tar is available.
 */
export async function ensureKitImage(
  client: IDockerClient,
  imageName: string,
  tarPath: string,
  log: (line: string) => void = () => {},
): Promise<void> {
  if (await client.imageExists(imageName)) return;
  if (!existsSync(tarPath)) {
    throw new Error(
      `kit image '${imageName}' not found on the daemon and no tar at '${tarPath}' — run 'npm run build:kit'`,
    );
  }
  log(`loading kit image ${imageName} from ${tarPath}`);
  await client.loadImage(tarPath);
  if (!(await client.imageExists(imageName))) {
    throw new Error(`loaded '${tarPath}' but image '${imageName}' is still absent (tar/arch mismatch?)`);
  }
  log(`kit image ${imageName} loaded`);
}
