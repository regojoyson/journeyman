import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GetRepoOptions, GetRepoResult } from "@journeyman/core";
import { callTool } from "../mcp-client.ts";

type GitHubRepoPayload = {
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
};

export async function getRepo(
  client: Client,
  opts: GetRepoOptions,
): Promise<GetRepoResult> {
  try {
    const r = await callTool<GitHubRepoPayload>(client, "get_repository", {
      owner: opts.owner,
      repo: opts.repo,
    });
    return {
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      defaultBranch: r.default_branch,
    };
  } catch (e) {
    return {
      name: "",
      fullName: "",
      url: "",
      defaultBranch: "",
      error: (e as Error).message,
    };
  }
}
