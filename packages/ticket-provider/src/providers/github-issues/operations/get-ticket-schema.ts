import type {
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
  TicketField,
} from "@journeyman/core";

const STATIC_FIELDS: TicketField[] = [
  { id: "title", name: "title", type: "string", required: true },
  { id: "body", name: "description", type: "string" },
  { id: "assignees", name: "assignees", type: "array<string>" },
  { id: "labels", name: "labels", type: "array<string>" },
  {
    id: "state",
    name: "state",
    type: "enum",
    allowedValues: ["open", "closed"],
  },
  { id: "milestone", name: "milestone", type: "string" },
];

export async function getTicketSchema(
  _opts: GetTicketSchemaOptions,
): Promise<GetTicketSchemaResult> {
  return { fields: STATIC_FIELDS };
}
