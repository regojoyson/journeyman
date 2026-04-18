import { query } from "@anthropic-ai/claude-agent-sdk";
import type { GetTicketOptions, GetTicketResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticket: {
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

function buildPrompt(opts: GetTicketOptions): string {
  return [
    `Fetch the Jira issue with key: ${opts.id}`,
    "Return the issue's id, title, description, status, assignee, labels, and url.",
  ].join("\n");
}

export async function getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
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
      if (msg.subtype === "success") return msg.structured_output as GetTicketResult;
      throw new Error((msg as any).errors?.[0] ?? msg.subtype);
    }
  }
  return { error: "No result received" };
}
