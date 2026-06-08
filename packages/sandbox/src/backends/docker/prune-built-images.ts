import type { IDockerClient } from "./docker-client.ts";

const BUILT_PREFIX = "journeyman/jm-built:";

/**
 * Remove `journeyman/jm-built:*` image tags that are NOT in `keep` — the fingerprint
 * tags of boxes still referenced by a ready sandbox. Other repos (node:20, the kit
 * images) are never touched. Per-image removal failures (image in use by a live
 * container) are swallowed so one stuck image can't block the rest. Returns the
 * tags actually removed.
 */
export async function pruneBuiltImages(
  client: IDockerClient,
  keep: Set<string>,
  log: (line: string) => void = () => {},
): Promise<string[]> {
  const tags = await client.listImageTags();
  const removed: string[] = [];
  for (const tag of tags) {
    if (!tag.startsWith(BUILT_PREFIX)) continue;
    if (keep.has(tag)) continue;
    try {
      await client.removeImage(tag);
      removed.push(tag);
    } catch (err) {
      log(`could not remove ${tag} (${(err as Error).message}); leaving for next sweep`);
    }
  }
  return removed;
}
