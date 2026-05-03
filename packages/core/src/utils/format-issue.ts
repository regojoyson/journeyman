import type { Issue } from "../types/issue.types.ts";

const MAX_COMMENTS = 10;

/** Lightweight runtime check that a value looks like an Issue object. */
export function isIssueLike(value: unknown): value is Issue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.title === "string";
}

/**
 * Serialise an Issue object into a string suitable for inclusion in an LLM
 * prompt. Emits a short markdown header (id + title + url) followed by a
 * fenced JSON block with the full object — preserves all context while
 * giving the model a clear "what is this" signal up front.
 *
 * Comments are tail-trimmed to MAX_COMMENTS and attachments are reduced to
 * { filename, url } to prevent thread/attachment-list bloat.
 */
export function formatIssueForPrompt(issue: Issue): string {
  const trimmed: Issue = {
    ...issue,
    comments: issue.comments?.slice(-MAX_COMMENTS),
    attachments: issue.attachments?.map((a) => ({
      id: a.id,
      filename: a.filename,
      url: a.url,
    })),
  };
  const header = `# ${issue.id}: ${issue.title}${issue.url ? `\n${issue.url}` : ""}`;
  return `${header}\n\n## Full issue data\n\n\`\`\`json\n${JSON.stringify(trimmed, null, 2)}\n\`\`\``;
}
