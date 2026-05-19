import type { Pool } from "pg";
import type {
  CustomAiStep,
  CustomAiStepCreateInput,
  CustomAiStepUpdateInput,
} from "@journeyman/core";

export class DuplicateCustomStepError extends Error {
  constructor(name: string) {
    super(`Custom step name already in use: ${name}`);
    this.name = "DuplicateCustomStepError";
  }
}

function rowToStep(r: any): CustomAiStep {
  return {
    id: r.id,
    scope: r.scope,
    userId: r.user_id ?? undefined,
    orgId: r.org_id,
    name: r.name,
    description: r.description ?? "",
    icon: r.icon ?? null,
    inputFields: r.input_fields ?? [],
    outputMode: r.output_mode,
    outputSchema: r.output_schema ?? undefined,
    promptTemplate: r.prompt_template ?? "",
    defaultTools: Array.isArray(r.default_tools) ? r.default_tools : [],
    defaultMcpIds: r.default_mcp_ids ?? [],
    defaultSkillIds: r.default_skill_ids ?? [],
    requiresSkills: r.requires_skills ?? false,
    requiresMcp: r.requires_mcp ?? false,
    slots: Array.isArray(r.slots) ? r.slots : [],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function insertCustomAiStep(
  pool: Pool,
  input: CustomAiStepCreateInput & { orgId: string; userId: string | null; createdBy: string },
): Promise<CustomAiStep> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO jm_custom_ai_steps
         (scope, user_id, org_id, name, description, icon,
          input_fields, output_mode, output_schema,
          prompt_template, default_tools,
          default_mcp_ids, default_skill_ids,
          slots,
          requires_skills,
          requires_mcp,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        input.scope,
        input.userId,
        input.orgId,
        input.name,
        input.description ?? "",
        input.icon ?? null,
        JSON.stringify(input.inputFields ?? []),
        input.outputMode ?? "none",
        input.outputSchema ? JSON.stringify(input.outputSchema) : null,
        input.promptTemplate ?? "",
        JSON.stringify(input.defaultTools ?? []),
        JSON.stringify(input.defaultMcpIds ?? []),
        JSON.stringify(input.defaultSkillIds ?? []),
        JSON.stringify(input.slots ?? []),
        input.requiresSkills ?? false,
        input.requiresMcp ?? false,
        input.createdBy,
      ],
    );
    return rowToStep(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") throw new DuplicateCustomStepError(input.name);
    throw err;
  }
}

export async function getCustomAiStep(
  pool: Pool,
  id: string,
): Promise<CustomAiStep | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_custom_ai_steps WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToStep(rows[0]) : null;
}

export async function listCustomAiSteps(
  pool: Pool,
  orgId: string,
  userId: string | null,
): Promise<CustomAiStep[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_custom_ai_steps
     WHERE org_id = $1
       AND COALESCE(user_id::text, '') = COALESCE($2::text, '')
     ORDER BY name ASC`,
    [orgId, userId],
  );
  return rows.map(rowToStep);
}

export async function listVisibleCustomAiSteps(
  pool: Pool,
  orgId: string,
  userId: string,
): Promise<CustomAiStep[]> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_custom_ai_steps
     WHERE org_id = $1
       AND (user_id IS NULL OR user_id = $2)
     ORDER BY name ASC`,
    [orgId, userId],
  );
  return rows.map(rowToStep);
}

export async function updateCustomAiStep(
  pool: Pool,
  id: string,
  patch: CustomAiStepUpdateInput,
): Promise<CustomAiStep | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.name !== undefined)            push("name", patch.name);
  if (patch.description !== undefined)     push("description", patch.description);
  if (patch.icon !== undefined)            push("icon", patch.icon);
  if (patch.inputFields !== undefined)     push("input_fields", JSON.stringify(patch.inputFields));
  if (patch.outputMode !== undefined)      push("output_mode", patch.outputMode);
  if (patch.outputSchema !== undefined)    push("output_schema", patch.outputSchema ? JSON.stringify(patch.outputSchema) : null);
  if (patch.promptTemplate !== undefined)  push("prompt_template", patch.promptTemplate);
  if (patch.defaultTools !== undefined)    push("default_tools", JSON.stringify(patch.defaultTools));
  if (patch.defaultMcpIds !== undefined)   push("default_mcp_ids", JSON.stringify(patch.defaultMcpIds));
  if (patch.defaultSkillIds !== undefined) push("default_skill_ids", JSON.stringify(patch.defaultSkillIds));
  if (patch.requiresSkills !== undefined)  push("requires_skills", patch.requiresSkills);
  if (patch.requiresMcp !== undefined)     push("requires_mcp", patch.requiresMcp);
  if (patch.slots !== undefined)           push("slots", JSON.stringify(patch.slots));
  if (sets.length === 0) return getCustomAiStep(pool, id);
  sets.push(`updated_at = now()`);
  vals.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE jm_custom_ai_steps SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
      vals,
    );
    return rows[0] ? rowToStep(rows[0]) : null;
  } catch (err: any) {
    if (err.code === "23505" && patch.name) throw new DuplicateCustomStepError(patch.name);
    throw err;
  }
}

export async function promoteCustomAiStepToOrg(
  pool: Pool,
  id: string,
  ownerUserId: string,
): Promise<CustomAiStep | null> {
  const { rows } = await pool.query(
    `UPDATE jm_custom_ai_steps
     SET scope = 'org', user_id = NULL, updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [id, ownerUserId],
  );
  return rows[0] ? rowToStep(rows[0]) : null;
}

export async function deleteCustomAiStep(pool: Pool, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM jm_custom_ai_steps WHERE id = $1`, [id],
  );
  return (rowCount ?? 0) > 0;
}
