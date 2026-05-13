import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type {
  CommitPushEntry,
  CommitPushReposOptions,
  CommitPushReposResult,
} from "@journeyman/core";

const log = createLogger("claude:commit-push-repos");

export type { CommitPushEntry, CommitPushReposOptions, CommitPushReposResult };

const DEFAULT_PATTERN = "{issue} : {summary}";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" },
          repoDir: { type: "string" },
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
          "repoDir",
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
  repoDir: string;
  issue?: string;
  message?: string;
};

function normalizeEntries(opts: CommitPushReposOptions): NormalizedEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => {
    if (typeof r === "string") {
      return { repoDir: r, issue: opts.issue };
    }
    return {
      repoDir: r.repoDir,
      issue: r.issue ?? opts.issue,
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
    "Tokens: {issue} (from entry.issue), {summary} (you generate it from the diff).",
    "If entry.issue is absent and the pattern contains {issue}, drop the issue",
    'portion cleanly (no leading/trailing " : " or "{issue}" literal).',
    "If entry.message is set, use it verbatim and skip {summary} generation.",
    "",
    `PR description style: ${prSummaryStyle}`,
    "",
    "Per repo, execute in order:",
    "1. `git -C <repoDir> status --porcelain`. If output is empty, record a",
    "   full result object with all required fields populated, using empty",
    "   strings/arrays for fields that would be derived from the missing changes:",
    '   { folderName: <basename(repoDir)>, repoDir: <repoDir>, branch: "",',
    '     commitSha: "", commitMessage: "", title: "", description: "",',
    '     filesChanged: [], pushed: false, error: "no changes" }',
    "   Then skip remaining steps for this repo.",
    "2. `git -C <repoDir> rev-parse --abbrev-ref HEAD` → branch.",
    "   If branch is 'HEAD' (detached HEAD state), stop processing this repo and",
    "   record the result with branch: 'HEAD', empty commit fields, pushed: false,",
    "   error: 'detached HEAD — refusing to commit'.",
    '   Also verify `git -C <repoDir> remote get-url origin`. If it fails, stop',
    "   and record pushed: false with error: 'no origin remote configured' (still",
    "   populate branch and filesChanged as best as possible, but skip commit/push).",
    "   Verify committer identity: `git -C <repoDir> config user.email` and",
    "   `git -C <repoDir> config user.name`. If either is empty, stop and record",
    "   pushed: false with error: 'git user.name/user.email not configured'.",
    "3. Collect changed files:",
    "   `git -C <repoDir> diff --name-only`",
    "   `git -C <repoDir> diff --cached --name-only`",
    "   `git -C <repoDir> ls-files --others --exclude-standard`",
    "   Union them into filesChanged (unique, sorted).",
    "4. Gather change context for the summary:",
    "   - `git -C <repoDir> diff HEAD` covers modified and deleted tracked files.",
    "   - Untracked files are already captured in filesChanged (step 3). For each",
    "     new file, also `cat` it (or head a reasonable amount) so the summary",
    "     reflects added files, not just edits.",
    "   If entry.message is not set, produce a concise imperative {summary}",
    "   (<= 72 chars, no trailing period) from the combined context.",
    "5. Build the final commitMessage:",
    "   - If entry.message is set, commitMessage = entry.message.",
    "   - Otherwise substitute {issue} and {summary} into the pattern.",
    "     If entry.issue is absent and the pattern contains {issue}, remove",
    "     the {issue} token AND any immediately adjacent separator chars",
    "     (e.g. ' : ', ': ', ' - ', '-') so no dangling punctuation remains.",
    "     Examples: '{issue} : {summary}' with no issue → '<summary>'.",
    "     'PROJ-{issue}: {summary}' with no issue → '<summary>' (prefix dropped).",
    "6. Build the PR-ready fields from the SAME diff:",
    "   - title: `<issue>: <summary>` (single space after colon) if entry.issue",
    "     is set, else just `<summary>`. Title is for PR/MR, not git log, so it",
    "     uses ': ' not ' : '.",
    "   - description: markdown summary of the actual code changes in the diff.",
    "     If prSummaryStyle is 'brief', write one short paragraph (2–3 sentences).",
    "     If 'detailed', write a one-line intro then a bulleted list of notable",
    "     file-by-file changes (what changed, not the full diff). No trailing",
    "     boilerplate. No generated-by footer.",
    "7. `git -C <repoDir> add -A`",
    '8. `git -C <repoDir> commit -m "<commitMessage>"`. If commit fails:',
    "    - If stderr mentions pre-commit/commit-msg hook failure, record pushed:",
    "      false with error: 'pre-commit hook failed: <stderr>' and skip push.",
    "    - If stderr mentions 'Please tell me who you are' / missing identity,",
    "      record pushed: false with error: 'git identity not configured'.",
    "    - If stderr mentions 'nothing to commit' (e.g. everything was gitignored",
    "      after add), record pushed: false with error: 'nothing to commit after",
    "      staging' and skip push.",
    "    - For any other commit failure, record pushed: false with the stderr as",
    "      error and skip push.",
    "    Do NOT retry with --no-verify under any circumstance.",
    "9. `git -C <repoDir> rev-parse HEAD` → commitSha.",
    "10. Push the branch, handling the case where it has no upstream yet:",
    "    - First try `git -C <repoDir> push origin <branch>`.",
    "    - If it fails because the branch has no upstream / does not exist on",
    "      remote (stderr mentions 'has no upstream branch', 'set-upstream',",
    "      'src refspec ... does not match any', or similar), retry with",
    "      `git -C <repoDir> push -u origin <branch>` to create and track it.",
    "    - If push is rejected as non-fast-forward (stderr mentions",
    "      'non-fast-forward', 'fetch first', or '[rejected]'), do NOT force-push",
    "      and do NOT auto-rebase. Record pushed: false with error:",
    "      'remote has diverging commits — pull/rebase required before push'.",
    "    - If push fails with auth/permission errors (stderr mentions",
    "      'Authentication failed', 'Permission denied', 'protected branch',",
    "      or 403), record pushed: false with error: 'push denied: <stderr>'.",
    "    - On success pushed: true. On any other failure, pushed: false and set",
    "      error to the stderr message verbatim.",
    "11. `git -C <repoDir> remote get-url origin` → remoteUrl (ignore errors here).",
    "",
    "folderName is the basename of repoDir.",
    "",
    "Return JSON matching the output schema: a repos array with one entry per",
    "input repo, and an optional top-level error only if the whole operation failed",
    "before any repo was processed.",
  ].join("\n");
}

export async function commitPushRepos(
  opts: CommitPushReposOptions
): Promise<CommitPushReposResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  if (opts?.repos == null) {
    log.error({ sessionId }, "commitPushRepos missing repos");
    return { repos: [], error: "repos is required", sessionId };
  }
  const entries = normalizeEntries(opts);
  log.info(
    { sessionId, repoCount: entries.length, issue: opts.issue },
    "commitPushRepos start",
  );
  if (entries.length === 0) {
    log.warn({ sessionId }, "commitPushRepos called with no repos");
    return { repos: [], sessionId };
  }
  const pattern = opts.pattern ?? DEFAULT_PATTERN;
  const prSummaryStyle = opts.prSummaryStyle ?? "detailed";
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  let output: CommitPushReposResult = { repos: [], sessionId };

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
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
  })) {
    logSdkMessage(msg, opts.onLog, opts.agentLogLevel ?? "all");
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        const error = (msg as any).errors?.[0] ?? msg.subtype;
        log.error({ sessionId, error }, "commitPushRepos failed");
        return { repos: [], error, sessionId };
      }
      output = { ...(msg.structured_output as CommitPushReposResult), sessionId };
    }
  }

  log.info(
    {
      sessionId,
      pushedCount: output.repos.filter((r) => r.pushed).length,
      failureCount: output.repos.filter((r) => !r.pushed).length,
    },
    "commitPushRepos done",
  );
  return output;
}

// Run: npx tsx packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
// Uncomment and edit `repoDir` to point at a local repo with uncommitted changes.
//
// const result = await commitPushRepos({
//   repos: [{ repoDir: "/absolute/path/to/repo" }],
//   issue: "EV-123",
// });
// console.log(JSON.stringify(result, null, 2));
