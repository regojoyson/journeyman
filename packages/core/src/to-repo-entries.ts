import type { RepoEntry } from "./types/git.types.ts";

/**
 * Normalize any repos input into RepoEntry[] ({ url, branch }).
 * Accepts: a string (newline/comma list), string[], a RepoEntry, or RepoEntry[].
 * - Per-repo branch is preserved; a missing/blank branch falls back to `fallbackBranch`
 *   (default ""), which means "clone the repo's default branch".
 * - URLs are trimmed; empty-url entries are dropped.
 */
export function toRepoEntries(repos: unknown, fallbackBranch = ""): RepoEntry[] {
  const fb = (fallbackBranch ?? "").trim();
  const arr = Array.isArray(repos) ? repos : repos == null ? [] : [repos];
  const out: RepoEntry[] = [];
  for (const r of arr) {
    if (typeof r === "string") {
      for (const url of r.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
        out.push({ url, branch: fb });
      }
    } else if (r && typeof r === "object") {
      const url = String((r as { url?: unknown }).url ?? "").trim();
      if (url) out.push({ url, branch: String((r as { branch?: unknown }).branch ?? fb).trim() });
    }
  }
  return out;
}
