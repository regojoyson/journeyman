import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve as resolvePath, sep } from "node:path";

export type ResolveResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Realpath-normalize the deepest existing ancestor of `p`, re-appending the
 * non-existent tail. This collapses `..` and follows symlinks for the parts
 * that exist (defeating symlink escapes) while still supporting write paths
 * whose final segments don't exist yet.
 */
function normalizeExisting(p: string): string {
  let cur = resolvePath(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(cur);
      return tail.length ? resolvePath(real, ...tail) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolvePath(p); // nothing in the chain exists
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

/**
 * Resolve `candidate` and assert it is the workspace `root` itself or a
 * descendant. Returns the safe absolute path, or a structured rejection.
 */
export function resolveWithinWorkspace(root: string, candidate: string): ResolveResult {
  const rootNorm = normalizeExisting(root);
  const absCandidate = isAbsolute(candidate) ? candidate : resolvePath(rootNorm, candidate);
  const target = normalizeExisting(absCandidate);
  if (target === rootNorm || target.startsWith(rootNorm + sep)) {
    return { ok: true, path: target };
  }
  return { ok: false, reason: `Path '${candidate}' is outside the workspace root '${root}'.` };
}
