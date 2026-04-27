/**
 * Reference to a credential. v1 only supports "env:<NAME>".
 * Phase 5 adds "user:<NAME>" and "flow:<NAME>" with overrides.
 */
export type CredentialRef = string;

export interface ICredentialStore {
  /**
   * Resolve refs into a flat env-var map suitable for passing to a child process.
   * Throws CredentialNotFoundError on any unresolved ref.
   */
  resolve(refs: Record<string, CredentialRef>, scope: {
    userId: string | null;
    flowId: string | null;
  }): Promise<Record<string, string>>;
}

export class CredentialNotFoundError extends Error {
  constructor(public readonly ref: string) {
    super(`Credential not found: ${ref}`);
    this.name = "CredentialNotFoundError";
  }
}
