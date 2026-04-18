
import type {
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
  TicketField,
} from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { parseProjectId } from "../utils/parse-project-id.ts";

// Replace with the discovered sub-method name.
const LIST_FIELDS_METHOD = "list_fields";

type ProjectFieldPayload = {
  id: string;
  name: string;
  dataType?: string;
  options?: { id: string; name: string }[];
};

export async function getTicketSchema(
  client: Client,
  opts: GetTicketSchemaOptions,
): Promise<GetTicketSchemaResult> {
  if (!opts.projectId) {
    return { fields: [], error: "projectId (owner/<project_number>) required" };
  }
  const { owner, project_number } = parseProjectId(opts.projectId);
  try {
    const fields = await callTool<ProjectFieldPayload[]>(client, "projects_get", {
      method: LIST_FIELDS_METHOD,
      owner,
      project_number,
    });
    const mapped: TicketField[] = fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.dataType?.toLowerCase(),
      allowedValues: f.options?.map((o) => o.name),
    }));
    return { fields: mapped };
  } catch (err) {
    return { fields: [], error: (err as Error).message };
  }
}
