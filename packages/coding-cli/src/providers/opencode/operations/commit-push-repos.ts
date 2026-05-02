// packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { CommitPushEntry, CommitPushReposOptions, CommitPushReposResult } from "@journeyman/core";

const log = createLogger("opencode:commit-push-repos");

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
        required: ["folderName", "repoDir", "branch", "commitSha", "commitMessage", "title", "description", "filesChanged", "pushed"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

const DEFAULT_TOOLS: Record<string, boolean> = { bash: true };

type NormalizedEntry = { repoDir: string; ticket?: string; message?: string };

function normalizeEntries(opts: CommitPushReposOptions): NormalizedEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => {
    if (typeof r === "string") return { repoDir: r, ticket: opts.ticket };
    return { repoDir: r.repoDir, ticket: r.ticket ?? opts.ticket, message: r.message };
  });
}

function buildPrompt(entries: NormalizedEntry[], pattern: string, prSummaryStyle: "brief" | "detailed"): string {
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
    "   and record pushed: false with error: 'no origin remote configured'.",
    "   Verify committer identity: `git -C <repoDir> config user.email` and",
    "   `git -C <repoDir> config user.name`. If either is empty, stop and record",
    "   pushed: false with error: 'git user.name/user.email not configured'.",
    "3. Collect changed files: git diff --name-only, git diff --cached --name-only, ls-files --others --exclude-standard. Union unique sorted.",
    "4. Gather change context for the summary: git diff HEAD covers modified/deleted tracked files. For untracked files, cat them. If entry.message is not set, produce a concise imperative summary (<= 72 chars, no trailing period).",
    "5. Build commitMessage from pattern substituting {ticket} and {summary}. If entry.message is set, use it verbatim.",
    "6. Build PR-ready fields: title (<ticket>: <summary> or just <summary>), description (markdown summary of changes).",
    "   If prSummaryStyle is 'brief', write one short paragraph. If 'detailed', write one-line intro then bulleted file-by-file changes.",
    "7. `git -C <repoDir> add -A`",
    "8. `git -C <repoDir> commit -m \"<commitMessage>\"`. On hook failure: record pushed: false with error. Never retry with --no-verify.",
    "9. `git -C <repoDir> rev-parse HEAD` → commitSha.",
    "10. Push: try `git push origin <branch>`. If no upstream, retry with `git push -u origin <branch>`. If non-fast-forward: record pushed: false with error 'remote has diverging commits — pull/rebase required'. If auth error: record pushed: false with error 'push denied: <stderr>'. On success: pushed: true.",
    "11. `git -C <repoDir> remote get-url origin` → remoteUrl.",
    "",
    "folderName is the basename of repoDir.",
    "",
    "Return JSON matching the output schema: a repos array with one entry per input repo, and an optional top-level error only if the whole operation failed before any repo was processed.",
  ].join("\n");
}

export async function commitPushRepos(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: CommitPushReposOptions,
): Promise<CommitPushReposResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const EMPTY: CommitPushReposResult = { repos: [], sessionId };

  if (opts?.repos == null) {
    log.error({ sessionId }, "commitPushRepos missing repos");
    return { ...EMPTY, error: "repos is required" };
  }

  const entries = normalizeEntries(opts);
  log.info({ sessionId, repoCount: entries.length, ticket: opts.ticket }, "commitPushRepos start");

  if (entries.length === 0) {
    log.warn({ sessionId }, "commitPushRepos called with no repos");
    return EMPTY;
  }

  const pattern = opts.pattern ?? DEFAULT_PATTERN;
  const prSummaryStyle = opts.prSummaryStyle ?? "detailed";

  const session = await client.session.create({ title: "commitPushRepos" });
  if (!session.data) throw new Error("opencode session.create returned no data");
  const sid = session.data.id;

  const result = await client.session.prompt({
    sessionID: sid,
    parts: [{ type: "text", text: buildPrompt(entries, pattern, prSummaryStyle) }],
    model: config.model,
    tools: { ...DEFAULT_TOOLS, ...(config.tools ?? {}) },
    format: { type: "json_schema", schema: OUTPUT_SCHEMA },
  });
  if (!result.data) throw new Error("opencode session.prompt returned no data");

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "commitPushRepos failed");
    return { ...EMPTY, error };
  }
  if (!info.structured) return EMPTY;

  const output = { ...(info.structured as CommitPushReposResult), sessionId };
  log.info({
    sessionId,
    pushedCount: output.repos.filter((r) => r.pushed).length,
    failureCount: output.repos.filter((r) => !r.pushed).length,
  }, "commitPushRepos done");
  return output;
}
