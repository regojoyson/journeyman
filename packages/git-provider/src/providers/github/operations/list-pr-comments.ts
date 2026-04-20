/**
 * @file list-pr-comments.ts
 * List review + issue comments on a GitHub pull request.
 *
 * Combines `octokit.pulls.listReviewComments` (inline code comments with path/line)
 * and `octokit.issues.listComments` (general PR discussion, no path/line) into a
 * single, chronologically-sorted PRComment[].
 */

import type { GitHubClient } from "@journeyman/github-api";
import type { ListPRCommentsOptions, ListPRCommentsResult, PRComment } from "@journeyman/core";

type Deps = { client: GitHubClient };

export async function listPRComments(
  opts: ListPRCommentsOptions,
  { client }: Deps,
): Promise<ListPRCommentsResult> {
  try {
    const parsed = parsePrUrl(opts.prUrl);
    if (!parsed) {
      return { sessionId: opts.sessionId, comments: [], error: `invalid prUrl: ${opts.prUrl}` };
    }
    const { owner, repo, number } = parsed;

    const [reviews, issue] = await Promise.all([
      client.rest.paginate(client.rest.pulls.listReviewComments, { owner, repo, pull_number: number, per_page: 100 }),
      client.rest.paginate(client.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 }),
    ]);

    const reviewComments: PRComment[] = reviews.map((c: any) => ({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      path: c.path ?? undefined,
      line: c.line ?? c.original_line ?? undefined,
      createdAt: c.created_at,
    }));
    const issueComments: PRComment[] = issue.map((c: any) => ({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      createdAt: c.created_at,
    }));

    let comments = [...reviewComments, ...issueComments]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (opts.sinceIso) {
      const since = opts.sinceIso;
      comments = comments.filter(c => c.createdAt >= since);
    }

    return { sessionId: opts.sessionId, comments };
  } catch (err: any) {
    return {
      sessionId: opts.sessionId,
      comments: [],
      error: err?.message ?? String(err),
    };
  }
}

/** Parse "https://github.com/owner/repo/pull/42" → { owner, repo, number }. */
function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}
