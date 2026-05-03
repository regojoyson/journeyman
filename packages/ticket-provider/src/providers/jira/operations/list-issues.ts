import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import type { ListIssuesOptions, ListIssuesResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const log = createLogger("jira:list-issues");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
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
    },
    error: { type: "string" },
  },
  required: ["issues"],
} as const;

function buildJql(opts: ListIssuesOptions): string {
  const clauses: string[] = [];
  if (opts.projectId) clauses.push(`project = "${opts.projectId}"`);
  if (opts.status) clauses.push(`status = "${opts.status}"`);
  if (opts.assignee) clauses.push(`assignee = "${opts.assignee}"`);
  const where = clauses.join(" AND ");
  return where ? `${where} ORDER BY created DESC` : "ORDER BY created DESC";
}

function buildPrompt(opts: ListIssuesOptions): string {
  return [
    `Search Jira issues using this JQL query: ${buildJql(opts)}`,
    "Return an array of issues, each with id, title, description, status, assignee, labels, and url.",
  ].join("\n");
}

export async function listIssues(opts: ListIssuesOptions): Promise<ListIssuesResult> {
  const jql = buildJql(opts);
  log.info({ jql }, "listIssues start");
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
        const result = msg.structured_output as ListIssuesResult;
        log.info({ count: result.issues?.length ?? 0 }, "listIssues done");
        return result;
      }
      const error = (msg as any).errors?.[0] ?? msg.subtype;
      log.error({ jql, error }, "listIssues failed");
      throw new Error(error);
    }
  }
  log.error({ jql }, "listIssues: no result received");
  return { issues: [], error: "No result received" };
}
