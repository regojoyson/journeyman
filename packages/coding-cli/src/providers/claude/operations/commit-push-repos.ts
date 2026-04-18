import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import type {
  CommitPushEntry,
  CommitPushReposOptions,
  CommitPushReposResult,
} from "@journeyman/core";

export type { CommitPushEntry, CommitPushReposOptions, CommitPushReposResult };

const DEFAULT_PATTERN = "{ticket} : {summary}";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" },
          dirPath: { type: "string" },
          branch: { type: "string" },
          commitSha: { type: "string" },
          commitMessage: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          filesChanged: { type: "array", items: { type: "string" } },
          pushed: { type: "boolean" },
          remoteUrl: { type: "string" },
          error: { type: "string" },
        },
        required: [
          "folderName",
          "dirPath",
          "branch",
          "commitSha",
          "commitMessage",
          "title",
          "description",
          "filesChanged",
          "pushed",
        ],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

type NormalizedEntry = {
  dirPath: string;
  ticket?: string;
  message?: string;
};

function normalizeEntries(opts: CommitPushReposOptions): NormalizedEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => {
    if (typeof r === "string") {
      return { dirPath: r, ticket: opts.ticket };
    }
    return {
      dirPath: r.dirPath,
      ticket: r.ticket ?? opts.ticket,
      message: r.message,
    };
  });
}

function buildPrompt(
  entries: NormalizedEntry[],
  pattern: string,
  prSummaryStyle: "brief" | "detailed"
): string {
  const entriesJson = JSON.stringify(entries, null, 2);

  return [
    "For each repo entry below, run these git steps using the Bash tool.",
    "Keep going for all repos even if some fail — record errors per repo.",
    "",
    `Entries:\n${entriesJson}`,
    "",
    `Commit message pattern: ${JSON.stringify(pattern)}`,
    "Tokens: {ticket} (from entry.ticket), {summary} (you generate it from the diff).",
    "If entry.ticket is absent and the pattern contains {ticket}, drop the ticket",
    'portion cleanly (no leading/trailing " : " or "{ticket}" literal).',
    "If entry.message is set, use it verbatim and skip {summary} generation.",
    "",
    `PR description style: ${prSummaryStyle}`,
    "",
    "Per repo, execute in order:",
    "1. `git -C <dirPath> status --porcelain`. If output is empty, record",
    '   { error: "no changes", pushed: false, title: "", description: "",',
    '     commitMessage: "", commitSha: "", filesChanged: [] } and skip remaining steps.',
    "2. `git -C <dirPath> rev-parse --abbrev-ref HEAD` → branch.",
    "3. Collect changed files:",
    "   `git -C <dirPath> diff --name-only`",
    "   `git -C <dirPath> diff --cached --name-only`",
    "   `git -C <dirPath> ls-files --others --exclude-standard`",
    "   Union them into filesChanged (unique, sorted).",
    "4. Run `git -C <dirPath> diff HEAD` to see the actual code changes.",
    "   If entry.message is not set, produce a concise imperative {summary}",
    "   (<= 72 chars, no trailing period) from this diff.",
    "5. Build the final commitMessage:",
    "   - If entry.message is set, commitMessage = entry.message.",
    "   - Otherwise substitute {ticket} and {summary} into the pattern.",
    "     If entry.ticket is absent and pattern starts with '{ticket} : ',",
    "     collapse the prefix — use just {summary}.",
    "6. Build the PR-ready fields from the SAME diff:",
    "   - title: `<ticket>: <summary>` (single space after colon) if entry.ticket",
    "     is set, else just `<summary>`. Title is for PR/MR, not git log, so it",
    "     uses ': ' not ' : '.",
    "   - description: markdown summary of the actual code changes in the diff.",
    "     If prSummaryStyle is 'brief', write one short paragraph (2–3 sentences).",
    "     If 'detailed', write a one-line intro then a bulleted list of notable",
    "     file-by-file changes (what changed, not the full diff). No trailing",
    "     boilerplate. No generated-by footer.",
    "7. `git -C <dirPath> add -A`",
    '8. `git -C <dirPath> commit -m "<commitMessage>"`',
    "9. `git -C <dirPath> rev-parse HEAD` → commitSha.",
    "10. `git -C <dirPath> push origin <branch>`. On success pushed: true,",
    "    on failure pushed: false and set error to the stderr message.",
    "11. `git -C <dirPath> remote get-url origin` → remoteUrl (ignore errors here).",
    "",
    "folderName is the basename of dirPath.",
    "",
    "Return JSON matching the output schema: a repos array with one entry per",
    "input repo, and an optional top-level error only if the whole operation failed",
    "before any repo was processed.",
  ].join("\n");
}

export async function commitPushRepos(
  opts: CommitPushReposOptions
): Promise<CommitPushReposResult> {
  const entries = normalizeEntries(opts);
  const pattern = opts.pattern ?? DEFAULT_PATTERN;
  const prSummaryStyle = opts.prSummaryStyle ?? "detailed";
  let output: CommitPushReposResult = { repos: [] };

  for await (const msg of query({
    prompt: buildPrompt(entries, pattern, prSummaryStyle),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        return { repos: [], error: (msg as any).result ?? msg.subtype };
      }
      output = msg.structured_output as CommitPushReposResult;
    }
  }

  return output;
}

// Run: npx tsx packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
// Uncomment and edit `dirPath` to point at a local repo with uncommitted changes.
//
// const result = await commitPushRepos({
//   repos: [{ dirPath: "/absolute/path/to/repo" }],
//   ticket: "EV-123",
// });
// console.log(JSON.stringify(result, null, 2));
