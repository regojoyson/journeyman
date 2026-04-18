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
        id:          { type: "string" },
        title:       { type: "string" },
        description: { type: "string" },
        status:      { type: "string" },
        assignee:    { type: "string" },
        labels:      { type: "array", items: { type: "string" } },
        url:         { type: "string" },
        priority:    { type: "string" },
        issueType:   { type: "string" },
        reporter:    { type: "string" },
        createdAt:   { type: "string" },
        updatedAt:   { type: "string" },
        comments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id:        { type: "string" },
              author:    { type: "string" },
              body:      { type: "string" },
              createdAt: { type: "string" },
            },
            required: ["id", "body"],
          },
        },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id:       { type: "string" },
              filename: { type: "string" },
              url:      { type: "string" },
              mimeType: { type: "string" },
              size:     { type: "number" },
            },
            required: ["id", "filename", "url"],
          },
        },
        customFields: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: GetTicketOptions): string {
  return [
    `Fetch the Jira issue with key: ${opts.id}`,
    "Return ALL available fields: id, title, description, status, assignee, labels, url,",
    "priority, issueType, reporter, createdAt, updatedAt, comments (with id/author/body/createdAt),",
    "attachments (with id/filename/url/mimeType/size), and customFields (all custom fields as a",
    "key-value object where keys are the Jira field IDs, e.g. customfield_10016).",
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
      throw new Error(msg.errors[0] ?? msg.subtype);
    }
  }
  return { error: "No result received" };
}
