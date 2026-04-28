import type { Pool } from "pg";
import {
  CredentialNotFoundError,
  type CredentialRef,
  type ICredentialStore,
  MissingSecretsError,
  type RunContext,
} from "@journeyman/core";
import { resolveSecrets } from "./resolver.ts";

export interface SecretsCredentialStoreDeps {
  pool: Pool;
  getRunContext: (input: { userId: string | null; flowId: string | null }) => Promise<RunContext | null>;
}

/**
 * Resolves credential refs of the form `env:<NAME>` via the user>org>global
 * secrets stack when a RunContext is available, falling back to `process.env`
 * (including `JM_GLOBAL_<NAME>`) when it isn't.
 */
export class SecretsCredentialStore implements ICredentialStore {
  constructor(private readonly deps: SecretsCredentialStoreDeps) {}

  async resolve(
    refs: Record<string, CredentialRef>,
    scope: { userId: string | null; flowId: string | null },
  ): Promise<Record<string, string>> {
    const parsed: Array<{ varName: string; name: string; ref: CredentialRef }> = [];
    for (const [varName, ref] of Object.entries(refs)) {
      const m = /^env:(.+)$/.exec(ref);
      if (!m) throw new CredentialNotFoundError(ref);
      parsed.push({ varName, name: m[1], ref });
    }
    if (parsed.length === 0) return {};

    const ctx = await this.deps.getRunContext(scope);
    const out: Record<string, string> = {};

    if (!ctx) {
      for (const p of parsed) {
        const v = process.env[`JM_GLOBAL_${p.name}`] ?? process.env[p.name];
        if (v == null) throw new CredentialNotFoundError(p.ref);
        out[p.varName] = v;
      }
      return out;
    }

    const names = Array.from(new Set(parsed.map(p => p.name)));
    let values: Record<string, string>;
    try {
      ({ values } = await resolveSecrets({ pool: this.deps.pool, ctx, names }));
    } catch (err) {
      if (err instanceof MissingSecretsError) {
        throw new CredentialNotFoundError(`env:${err.missing[0]}`);
      }
      throw err;
    }
    for (const p of parsed) out[p.varName] = values[p.name];
    return out;
  }
}
