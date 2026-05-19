import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import type { UpdateIssueOptions, UpdateIssueResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const log = createLogger("jira:update-issue");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    issue: {
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

function buildPrompt(opts: UpdateIssueOptions): string {
  const parts = [`Update Jira issue with key: ${opts.id}`];
  if (opts.title)            parts.push(`New title: ${opts.title}`);
  if (opts.description)      parts.push(`New description: ${opts.description}`);
  if (opts.status)           parts.push(`New status (transition to): ${opts.status}`);
  if (opts.assignee)         parts.push(`New assignee account ID or email: ${opts.assignee}`);
  if (opts.labels?.length)   parts.push(`New labels: ${opts.labels.join(", ")}`);
  if (opts.priority)         parts.push(`New priority: ${opts.priority}`);
  if (opts.customFields && Object.keys(opts.customFields).length > 0) {
    parts.push(
      `Custom field updates (keys are Jira field IDs, e.g. customfield_10016): ${JSON.stringify(opts.customFields)}`
    );
  }
  parts.push("Return the updated issue's full details: id, title, description, status, assignee, labels, url, priority, issueType, reporter, createdAt, updatedAt, comments, attachments, and customFields.");
  return parts.join("\n");
}

export async function updateIssue(opts: UpdateIssueOptions): Promise<UpdateIssueResult> {
  log.info(
    {
      issueRef: opts.id,
      fields: Object.keys(opts).filter((k) => k !== "id" && (opts as any)[k] !== undefined),
    },
    "updateIssue start",
  );
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
        const result = msg.structured_output as UpdateIssueResult;
        log.info({ issueRef: opts.id }, "updateIssue done");
        return result;
      }
      const error = msg.errors?.[0] ?? msg.subtype;
      log.error({ issueRef: opts.id, error }, "updateIssue failed");
      throw new Error(error);
    }
  }
  log.error({ issueRef: opts.id }, "updateIssue: no result received");
  return { error: "No result received" };
}
