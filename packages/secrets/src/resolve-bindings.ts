import type { Pool } from "pg";
import {
  MissingSecretsError,
  type RunContext,
  type SecretBinding,
} from "@journeyman/core";
import { validateName, fetchPinnedUserSecret, fetchPinnedOrgSecret } from "./db.ts";
import { resolveSecrets } from "./resolver.ts";
import { readGlobalSecrets } from "./global.ts";

export interface SecretSlotSpec {
  name: string;
  optional?: boolean;
}

export interface ResolveBindingsInput {
  pool: Pool;
  ctx: RunContext;
  bindings: Record<string, SecretBinding>;
  slots: SecretSlotSpec[];
}

export interface ResolveBindingsResult {
  values: Record<string, string>;
}

/**
 * Resolve every slot to a concrete value.
 *
 * - mode "pinned" → fetch exactly (scope, name); missing → MissingSecretsError.
 * - mode "auto"   → walk user > org > global on the slot's name; missing +
 *                   slot.optional → omit; missing + required → MissingSecretsError.
 */
export async function resolveBindings(input: ResolveBindingsInput): Promise<ResolveBindingsResult> {
  const { pool, ctx, bindings, slots } = input;
  const values: Record<string, string> = {};
  const missing: string[] = [];

  for (const slot of slots) {
    validateName(slot.name);
    const binding = bindings[slot.name] ?? { mode: "auto" as const };

    if (binding.mode === "pinned") {
      validateName(binding.name);
      let v: string | null = null;
      if (binding.scope === "user") {
        v = await fetchPinnedUserSecret(pool, ctx.org.id, ctx.user.id, binding.name);
      } else if (binding.scope === "org") {
        v = await fetchPinnedOrgSecret(pool, ctx.org.id, binding.name);
      } else if (binding.scope === "global") {
        v = readGlobalSecrets()[binding.name] ?? null;
      }
      if (v == null) { missing.push(slot.name); continue; }
      values[slot.name] = v;
      continue;
    }

    // mode "auto" — single-name resolve through user > org > global.
    try {
      const r = await resolveSecrets({ pool, ctx, names: [slot.name] });
      values[slot.name] = r.values[slot.name];
    } catch (err) {
      if (err instanceof MissingSecretsError) {
        if (!slot.optional) missing.push(slot.name);
        continue;
      }
      throw err;
    }
  }

  if (missing.length > 0) throw new MissingSecretsError(missing);
  return { values };
}
