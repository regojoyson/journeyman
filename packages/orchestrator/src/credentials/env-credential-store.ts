import {
  CredentialNotFoundError,
  type CredentialRef,
  type ICredentialStore,
} from "@journeyman/core";

/**
 * v1 credential store: refs are env-var names. e.g. ref `"env:GITHUB_TOKEN"`
 * resolves to `process.env.GITHUB_TOKEN`. Throws if missing.
 */
export class EnvCredentialStore implements ICredentialStore {
  constructor(private env: NodeJS.ProcessEnv = process.env) {}

  async resolve(
    refs: Record<string, CredentialRef>,
    _scope: { userId: string | null; flowId: string | null },
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [varName, ref] of Object.entries(refs)) {
      const m = /^env:(.+)$/.exec(ref);
      if (!m) throw new CredentialNotFoundError(ref);
      const value = this.env[m[1]];
      if (value === undefined) throw new CredentialNotFoundError(ref);
      out[varName] = value;
    }
    return out;
  }
}
