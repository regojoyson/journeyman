import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import type { GetTicketOptions, GetTicketResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const log = createLogger("jira:get-ticket");

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
  log.info({ issueRef: opts.id }, "getTicket start");
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
        const result = msg.structured_output as GetTicketResult;
        log.info({ issueRef: opts.id, found: !!result.ticket }, "getTicket done");
        return result;
      }
      const error = msg.errors?.[0] ?? msg.subtype;
      log.error({ issueRef: opts.id, error }, "getTicket failed");
      throw new Error(error);
    }
  }
  log.error({ issueRef: opts.id }, "getTicket: no result received");
  return { error: "No result received" };
}
