import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { ScanReposOptions, ScanReposResult } from "@journeyman/core";

export type { ScanReposOptions, ScanReposResult };

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
          url: { type: "string" },
          branch: { type: "string" },
          isGitRepo: { type: "boolean" },
        },
        required: ["folderName", "dirPath", "isGitRepo"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

function buildPrompt(parentDir: string): string {
  return [
    `List all immediate subdirectories of: ${parentDir}`,
    "For each subdirectory:",
    "  1. Check if it is a git repo (look for a .git folder inside it)",
    "  2. If it is, get its remote origin URL via: git -C <dirPath> remote get-url origin",
    "  3. If it is, get its current branch via: git -C <dirPath> branch --show-current",
    "Return JSON with a repos array containing folderName, dirPath, isGitRepo, and url and branch (only if it is a git repo).",
  ].join("\n");
}

/**
 * Scans a parent directory and classifies each immediate subdirectory as a git
 * repo or not. For git repos it also returns the remote origin URL and the
 * current branch name.
 *
 * @param opts - Options containing the parentDir to scan.
 * @returns A ScanReposResult with every subdirectory's metadata.
 *
 * @example
 * ```ts
 * const result = await scanRepos({ parentDir: "/Users/me/projects" });
 * const gitRepos = result.repos.filter((r) => r.isGitRepo);
 * ```
 */
export async function scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  let output: ScanReposResult = { repos: [], sessionId };

  for await (const msg of query({
    prompt: buildPrompt(opts.parentDir),
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
        return { repos: [], error: (msg as any).errors?.[0] ?? msg.subtype, sessionId };
      }
      output = { ...(msg.structured_output as ScanReposResult), sessionId };
    }
  }

  return output;
}

// Run directly: npx tsx scan-repos.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await scanRepos({
    parentDir: "/Users/admin/data/workspace/claude-skils/",
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
