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

  // A digest-pinned ref (`<repo>@sha256:…`) already names exact content, and that
  // digest is baked into the recipe text (the COPY --from / FROM line), so the
  // recipe alone fingerprints it. Folding the LOCAL image id on top would make the
  // fingerprint depend on the image being present on the daemon — which breaks the
  // moment the daemon GCs the kit image (k3s/kubelet does this): the id resolves to
  // "", the fingerprint silently changes, and the freshness gate sees permanent
  // "drift" and rebuilds on every run. Only fold the local id for MUTABLE refs,
  // where it's the only way to notice a tag that moved.
  const bundleId = isPinned(args.bundleRef)
    ? ""
    : ((await args.client.imageId(args.bundleRef)) ?? "");

  let baseRefId = "";
  let dockerfilePull = false;
  if (args.image?.kind === "ref" && args.image.imageRef?.trim()) {
    const ref = args.image.imageRef.trim();
    if (!isPinned(ref)) {
      const timeout = args.pullTimeoutMs ?? 60_000;
      let timerId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          args.client.pullImage(ref),
          new Promise<void>((_, reject) => {
            timerId = setTimeout(
              () => reject(new Error(`pull timed out after ${timeout / 1000}s`)),
              timeout,
            );
          }),
        ]);
      } catch (err) {
        log(`warning: could not pull '${ref}' (${(err as Error).message}); using local copy`);
      } finally {
        clearTimeout(timerId);
      }
      // Mutable ref: fold its current local id so a moved tag ⇒ a new fingerprint.
      baseRefId = (await args.client.imageId(ref)) ?? "";
    }
    // Pinned base ref: its digest is already in the recipe's FROM line — nothing to fold.
  } else if (args.image?.kind === "dockerfile") {
    dockerfilePull = true;
  }

  const fingerprint = computeFingerprint(effectiveRecipe, bundleId, baseRefId);
  const imageRef = `${args.tagPrefix ?? "journeyman/jm-built"}:${fingerprint}`;
  return { effectiveRecipe, bundleId, baseRefId, fingerprint, imageRef, dockerfilePull };
}
