import { list as tarList, type ReadEntry } from "tar";

/**
 * Read the image id of a `docker save` tar by parsing only its `manifest.json`
 * (node-tar skips the bodies of every other entry, so this never buffers layers).
 * Returns the config digest as `sha256:<hex>` — the same value `imageId(tag)`
 * reports for the loaded image, so the two can be compared directly.
 */
export async function readImageIdFromTar(tarPath: string): Promise<string> {
  let json = "";
  await tarList({
    file: tarPath,
    filter: (p: string) => p === "manifest.json" || p === "./manifest.json",
    onentry: (entry: ReadEntry) => {
      entry.on("data", (c: Buffer) => { json += c.toString("utf8"); });
    },
  });
  if (!json) {
    throw new Error(`tar '${tarPath}' has no manifest.json (corrupt or not a 'docker save' archive)`);
  }
  const manifest = JSON.parse(json) as Array<{ Config?: string }>;
  const config = manifest?.[0]?.Config;
  if (!config) {
    throw new Error(`tar '${tarPath}' manifest.json has no Config (unexpected docker save format)`);
  }
  const hex = config
    .replace(/^blobs\/sha256\//, "")
    .replace(/\.json$/, "")
    .replace(/^sha256:/, "");
  return `sha256:${hex}`;
}
