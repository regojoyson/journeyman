import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "@journeyman/core";
import type { GetTicketSchemaOptions, GetTicketSchemaResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const log = createLogger("jira:get-ticket-schema");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:            { type: "string" },
          name:          { type: "string" },
          type:          { type: "string" },
          required:      { type: "boolean" },
          allowedValues: { type: "array", items: { type: "string" } },
        },
        required: ["id", "name"],
      },
    },
    error: { type: "string" },
  },
  required: ["fields"],
} as const;

function buildPrompt(opts: GetTicketSchemaOptions): string {
  const parts = [`Fetch the Jira issue with key: ${opts.ticketId}`];
  if (opts.projectId) {
    parts.push(`The project key is: ${opts.projectId}`);
  } else {
    parts.push("Determine the project key and issue type from the ticket.");
  }
  parts.push(
    "Then fetch the field metadata for that project and issue type using the Jira issue type metadata API.",
    "Return an array of fields, each with: id (Jira field key, e.g. customfield_10016), name (human-readable label),",
    "type (field type, e.g. string, number, option, array), required (boolean), and allowedValues (array of valid",
    "string values for option/array fields).",
    "If field metadata is unavailable due to permissions or configuration, return an empty fields array and set",
    "the error property to a short explanation."
  );
  return parts.join("\n");
}

export async function getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
  log.info({ ticketId: opts.ticketId, projectId: opts.projectId }, "getTicketSchema start");
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
        const result = msg.structured_output as GetTicketSchemaResult;
        log.info({ ticketId: opts.ticketId, fieldCount: result.fields?.length ?? 0 }, "getTicketSchema done");
        return result;
      }
      const error = msg.errors?.[0] ?? msg.subtype;
      log.error({ ticketId: opts.ticketId, error }, "getTicketSchema failed");
      return { fields: [], error };
    }
  }
  log.error({ ticketId: opts.ticketId }, "getTicketSchema: no result received");
  return { fields: [], error: "No result received" };
}
