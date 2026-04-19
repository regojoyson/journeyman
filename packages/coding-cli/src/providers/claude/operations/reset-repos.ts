import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { ResetEntry, ResetReposOptions, ResetReposResult } from "@journeyman/core";

export type { ResetEntry, ResetReposOptions, ResetReposResult };

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
          success: { type: "boolean" },
          error: { type: "string" },
        },
        required: ["folderName", "dirPath", "branch", "success"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

function normalizeEntries(opts: ResetReposOptions): ResetEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) =>
    typeof r === "string" ? { dirPath: r, branch: opts.branch ?? "main" } : r
  );
}

function buildPrompt(entries: ResetEntry[]): string {
  const steps = entries
    .map(
      ({ dirPath, branch }) =>
        `  - ${dirPath} → branch: ${branch}`
    )
    .join("\n");

  return [
    "For each repo below, run these steps in order to force-sync local code to the remote branch:",
    "  1. git -C <dirPath> fetch origin",
    "  2. git -C <dirPath> stash --include-untracked   (discard any local changes so checkout won't be blocked)",
    "  3. git -C <dirPath> checkout <branch>",
    "  4. git -C <dirPath> reset --hard origin/<branch>",
    "  5. git -C <dirPath> clean -fd                   (remove untracked files/dirs left behind)",
    "Repos:",
    steps,
    "Capture any error per repo. Return JSON with repos array (folderName, dirPath, branch, success, error if failed) and a global error if everything failed.",
  ].join("\n");
}

/**
 * Checks out the given branch in each repo and hard resets it to match
 * origin — making the local code identical to the remote branch.
 *
 * @param opts - Repos to reset and the target branch for each.
 * @returns A ResetReposResult with per-repo success/error details.
 *
 * @example
 * ```ts
 * const result = await resetRepos({
 *   repos: [
 *     { dirPath: "/projects/api", branch: "prod" },
 *     { dirPath: "/projects/web", branch: "prod" },
 *   ],
 * });
 * ```
 */
export async function resetRepos(opts: ResetReposOptions): Promise<ResetReposResult> {
  const entries = normalizeEntries(opts);
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  let output: ResetReposResult = { repos: [], sessionId };

  for await (const msg of query({
    prompt: buildPrompt(entries),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        return { repos: [], error: (msg as any).result ?? msg.subtype, sessionId };
      }
      output = { ...(msg.structured_output as ResetReposResult), sessionId };
    }
  }

  return output;
}

// Run directly: npx tsx reset-repos.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await resetRepos({
    repos: [
      { dirPath: "/Users/admin/data/workspace/my-api", branch: "prod" },
      { dirPath: "/Users/admin/data/workspace/my-web", branch: "prod" },
    ],
  });

  console.log(JSON.stringify(result, null, 2));
}
