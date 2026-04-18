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
