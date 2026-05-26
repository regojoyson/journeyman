import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import type { CreateIssueOptions, CreateIssueResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const log = createLogger("jira:create-issue");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    issue: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        assignee: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        url: { type: "string" },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: CreateIssueOptions): string {
  const parts = [
    "Create a Jira issue with the following details:",
    `Title: ${opts.title}`,
    "Issue type: Task",
  ];
  if (opts.description) parts.push(`Description: ${opts.description}`);
  if (opts.projectId) parts.push(`Project ID or key: ${opts.projectId}`);
  if (opts.assignee) parts.push(`Assignee account ID or email: ${opts.assignee}`);
  if (opts.labels?.length) parts.push(`Labels: ${opts.labels.join(", ")}`);
  parts.push("Return the created issue's id, title, description, status, assignee, labels, and url.");
  return parts.join("\n");
}

export async function createIssue(opts: CreateIssueOptions): Promise<CreateIssueResult> {
  log.info({ projectId: opts.projectId, title: opts.title }, "createIssue start");
  for await (const msg of query({
    prompt: buildPrompt(opts),
    options: {
      tools: [],
      allowedTools: [],
      mcpServers: { atlassian: buildMcpConfig() },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype === "success") {
        const result = msg.structured_output as CreateIssueResult;
        log.info({ ref: result.issue?.id }, "createIssue done");
        return result;
      }
      const error = (msg as any).errors?.[0] ?? msg.subtype;
      log.error({ error }, "createIssue failed");
      throw new Error(error);
    }
  }
  log.error("createIssue: no result received");
  return { error: "No result received" };
}
