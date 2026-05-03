import type {
  GetIssueSchemaOptions,
  GetIssueSchemaResult,
  IssueField,
} from "@journeyman/core";

const STATIC_FIELDS: IssueField[] = [
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

export async function getIssueSchema(
  _opts: GetIssueSchemaOptions,
): Promise<GetIssueSchemaResult> {
  return { fields: STATIC_FIELDS };
}
