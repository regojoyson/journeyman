import { createHash } from "node:crypto";
import { wrapDockerfile } from "./dockerfile-wrap.ts";

export type ImageConfig =
  | { kind?: "dockerfile"; content?: string }
  | { kind?: "ref"; imageRef?: string }
  | undefined;

/**
 * The effective Dockerfile we will build for a sandbox's image, with the
 * runner kit always grafted on. Returns null when no build is needed (empty
 * image → the default runner box already contains the kit).
 */
export function buildEffectiveRecipe(image: ImageConfig, bundleRef: string): string | null {
  if (image?.kind === "dockerfile" && typeof image.content === "string" && image.content.trim()) {
    return wrapDockerfile(image.content, bundleRef);
  }
  if (image?.kind === "ref" && typeof image.imageRef === "string" && image.imageRef.trim()) {
    return wrapDockerfile(`FROM ${image.imageRef}\n`, bundleRef);
  }
  return null;
}

/** Stable 16-hex fingerprint of (recipe + kit/bundle digest + base-ref digest). */
export function computeFingerprint(
  effectiveRecipe: string,
  bundleId: string,
  baseRefId = "",
): string {
  return createHash("sha256")
    .update(effectiveRecipe)
    .update("\0")
    .update(bundleId)
    .update("\0")
    .update(baseRefId)
    .digest("hex")
    .slice(0, 16);
}
