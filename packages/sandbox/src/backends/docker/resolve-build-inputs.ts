import type { IDockerClient } from "./docker-client.ts";
import { buildEffectiveRecipe, computeFingerprint, type ImageConfig } from "./recipe.ts";

export interface ResolveBuildInputsArgs {
  image: ImageConfig;
  client: IDockerClient;
  bundleRef: string;
  tagPrefix?: string;
  log?: (line: string) => void;
  /** Milliseconds before a mutable-ref pull is abandoned (default 60 000). */
  pullTimeoutMs?: number;
}

export interface BuildInputs {
  effectiveRecipe: string;
  bundleId: string;
  baseRefId: string;
  fingerprint: string;
  imageRef: string;
  /** Pass --pull to the build (dockerfile recipes only; refs are pulled explicitly). */
  dockerfilePull: boolean;
}

/** True for an already-digest-pinned ref (`name@sha256:...`) — cannot move, so never pulled. */
function isPinned(ref: string): boolean {
  return /@sha256:[0-9a-f]{64}$/i.test(ref.trim());
}

/**
 * Resolve everything a box build depends on RIGHT NOW: the grafted recipe, the
 * kit (bundle) image id, and the base-ref id (best-effort pulled for mutable
 * refs). The fingerprint folds all three, so a moved kit OR a moved base ⇒ a new
 * tag ⇒ a rebuild. Shared by the builder and the per-run freshness gate.
 */
export async function resolveBuildInputs(args: ResolveBuildInputsArgs): Promise<BuildInputs> {
  const log = args.log ?? (() => {});
  const effectiveRecipe = buildEffectiveRecipe(args.image, args.bundleRef);
  if (effectiveRecipe === null) throw new Error("no image recipe to build (empty image)");

  const bundleId = (await args.client.imageId(args.bundleRef)) ?? "";

  let baseRefId = "";
  let dockerfilePull = false;
  if (args.image?.kind === "ref" && args.image.imageRef?.trim()) {
    const ref = args.image.imageRef.trim();
    if (!isPinned(ref)) {
      const timeout = args.pullTimeoutMs ?? 60_000;
      try {
        await Promise.race([
          args.client.pullImage(ref),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`pull timed out after ${timeout / 1000}s`)), timeout)
          ),
        ]);
      } catch (err) {
        log(`warning: could not pull '${ref}' (${(err as Error).message}); using local copy`);
      }
    }
    baseRefId = (await args.client.imageId(ref)) ?? "";
  } else if (args.image?.kind === "dockerfile") {
    dockerfilePull = true;
  }

  const fingerprint = computeFingerprint(effectiveRecipe, bundleId, baseRefId);
  const imageRef = `${args.tagPrefix ?? "journeyman/jm-built"}:${fingerprint}`;
  return { effectiveRecipe, bundleId, baseRefId, fingerprint, imageRef, dockerfilePull };
}
