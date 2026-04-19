/**
 * Build a tokenized HTTPS clone URL for GitHub.
 *
 * Input:  https://github.com/<owner>/<repo> (with or without .git)
 * Output: https://x-access-token:<token>@github.com/<owner>/<repo>.git
 */
export function buildCloneUrl(repoUrl: string, token: string): string {
  if (!token) throw new Error("buildCloneUrl: token required");
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error(`buildCloneUrl: only https:// URLs supported, got ${repoUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`buildCloneUrl: only https:// URLs supported, got ${repoUrl}`);
  }
  if (parsed.host !== "github.com") {
    // TODO: GitHub Enterprise host support via GitHubProviderOptions.host
    throw new Error(`buildCloneUrl: only github.com host supported, got ${parsed.host}`);
  }
  const path = parsed.pathname.endsWith(".git") ? parsed.pathname : `${parsed.pathname}.git`;
  return `https://x-access-token:${token}@github.com${path}`;
}
