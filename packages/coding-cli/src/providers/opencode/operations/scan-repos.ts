// packages/coding-cli/src/providers/opencode/operations/scan-repos.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { ScanReposOptions, ScanReposResult } from "@journeyman/core";

const log = createLogger("opencode:scan-repos");

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
          url: { type: "string" },
          branch: { type: "string" },
          isGitRepo: { type: "boolean" },
        },
        required: ["folderName", "repoDir", "isGitRepo"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

const DEFAULT_TOOLS: Record<string, boolean> = { bash: true };

function buildPrompt(parentDir: string): string {
  return [
    `List all immediate subdirectories of: ${parentDir}`,
    "For each subdirectory:",
    "  1. Check if it is a git repo (look for a .git folder inside it)",
    "  2. If it is, get its remote origin URL via: git -C <repoDir> remote get-url origin",
    "  3. If it is, get its current branch via: git -C <repoDir> branch --show-current",
    "Return JSON with a repos array containing folderName, repoDir, isGitRepo, and url and branch (only if it is a git repo).",
  ].join("\n");
}

export async function scanRepos(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: ScanReposOptions,
): Promise<ScanReposResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const EMPTY: ScanReposResult = { repos: [], sessionId };
  log.info({ sessionId, parentDir: opts.parentDir }, "scanRepos start");

  const session = await client.session.create({ title: "scanRepos" });
  if (!session.data) throw new Error("opencode session.create returned no data");
  const sid = session.data.id;

  const result = await client.session.prompt({
    sessionID: sid,
    parts: [{ type: "text", text: buildPrompt(opts.parentDir) }],
    model: config.model,
    tools: { ...DEFAULT_TOOLS, ...(config.tools ?? {}) },
    format: { type: "json_schema", schema: OUTPUT_SCHEMA },
  });
  if (!result.data) throw new Error("opencode session.prompt returned no data");

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "scanRepos failed");
    return { ...EMPTY, error };
  }
  if (!info.structured) return EMPTY;

  const output = { ...(info.structured as ScanReposResult), sessionId };
  log.info({
    sessionId,
    repoCount: output.repos.length,
    gitRepoCount: output.repos.filter((r) => r.isGitRepo).length,
  }, "scanRepos done");
  return output;
}
