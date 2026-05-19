import type { Pool } from "pg";
import { MissingSecretsError, type RunContext } from "@journeyman/core";
import { validateName, fetchForResolve } from "./db.ts";
import { readGlobalSecrets } from "./global.ts";

export interface ResolveInput {
  pool: Pool;
  ctx: RunContext;
  names: string[];
}

export interface ResolveResult { values: Record<string, string>; }

export async function resolveSecrets(input: ResolveInput): Promise<ResolveResult> {
  const names = Array.from(new Set(input.names));
  for (const n of names) validateName(n);
  if (names.length === 0) return { values: {} };

  const rows = await fetchForResolve(input.pool, input.ctx.org.id, input.ctx.user.id, names);

  // Pick: user-scope row beats org-scope row, regardless of fetch order.
  const picked: Record<string, string> = {};
  for (const row of rows) {
    const isUserScope = row.userId === input.ctx.user.id;
    if (isUserScope) picked[row.name] = row.value;
    else if (picked[row.name] === undefined) picked[row.name] = row.value;
  }

  const globals = readGlobalSecrets();
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    if (picked[name] !== undefined) values[name] = picked[name];
    else if (globals[name] !== undefined) values[name] = globals[name];
    else missing.push(name);
  }
  if (missing.length > 0) throw new MissingSecretsError(missing);
  return { values };
}
