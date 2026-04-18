import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CreatePROptions, CreatePRResult } from "@journeyman/core";
import { callTool } from "../mcp-client.ts";

type GitHubPRPayload = {
  id: number;
  number: number;
  html_url: string;
};

export async function createPR(
  client: Client,
  opts: CreatePROptions,
): Promise<CreatePRResult> {
  try {
    const r = await callTool<GitHubPRPayload>(client, "create_pull_request", {
      owner: opts.owner,
      repo: opts.repo,
      title: opts.title,
      body: opts.body,
      head: opts.sourceBranch,
      base: opts.targetBranch,
    });
    return { id: String(r.id), url: r.html_url, number: r.number, sessionId: opts.sessionId };
  } catch (e) {
    return { id: "", url: "", number: 0, error: (e as Error).message, sessionId: opts.sessionId };
  }
}
