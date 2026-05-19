import type { Pool } from "pg";
import type { ScopeLookup, ResourceScope } from "./scope-guard.ts";

/**
 * For `jm_skill_packages` and `jm_mcp_instances`, scope is encoded by the
 * presence of `user_id`: row with user_id => user-scoped, row without => org-scoped.
 * There is no global scope in the current schema.
 */
export function buildScopeLookup(pool: Pool): ScopeLookup {
  const queryScope = async (table: string, id: string): Promise<{ scope: ResourceScope } | null> => {
    const { rows } = await pool.query<{ user_id: string | null }>(
      `SELECT user_id FROM ${table} WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    return { scope: rows[0].user_id ? "user" : "org" };
  };
  return {
    skill: (id) => queryScope("jm_skill_packages", id),
    mcp:   (id) => queryScope("jm_mcp_instances", id),
  };
}
