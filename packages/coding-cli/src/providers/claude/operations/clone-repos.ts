import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import type { RepoEntry, CloneReposOptions, CloneReposResult } from "@journeyman/core";

export type { RepoEntry, CloneReposOptions, CloneReposResult };

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
          error: { type: "string" },
        },
        required: ["folderName", "dirPath", "url", "branch"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

function repoName(url: string): string {
  return url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
}

function normalizeEntries(opts: CloneReposOptions): RepoEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) =>
    typeof r === "string" ? { url: r, branch: opts.branch ?? "main" } : r
  );
}

function buildPrompt(entries: RepoEntry[], dir: string): string {
  const commands = entries
    .map(({ url, branch }) =>
      `git clone --branch ${branch} --single-branch ${url} ${dir}/${repoName(url)}`
    )
    .join("\n");

  return [
    "Run each git clone command one by one:",
    commands,
    "For each, capture any error message.",
    "Return JSON with a repos array (folderName, dirPath, url, branch, error if failed)",
    "and a global error if the entire operation failed.",
  ].join("\n");
}

export async function cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
  const entries = normalizeEntries(opts);
  const dir = opts.targetDir ?? process.cwd();
  let output: CloneReposResult = { repos: [] };

  for await (const msg of query({
    prompt: buildPrompt(entries, dir),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
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
      output = msg.structured_output as CloneReposResult;
    }
  }

  return output;
}

// Run: npx tsx clone-repos.ts
const result = await cloneRepos({
  repos: [
    { url: "https://github.com/anthropics/anthropic-sdk-python.git", branch: "main" },
    { url: "https://github.com/anthropics/anthropic-sdk-java.git", branch: "devvv" },
  ],
  targetDir: "/Users/admin/data/workspace/claude-skils/claude-sdk-test",
});

console.log(JSON.stringify(result, null, 2));
