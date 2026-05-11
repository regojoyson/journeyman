import type { SecretScope } from "@journeyman/core";

export interface VisibleSecret {
  name: string;
  scope: SecretScope;
}

export interface VisibleSecretsResponse {
  names: string[];
  scoped: VisibleSecret[];
}

const EMPTY: VisibleSecretsResponse = { names: [], scoped: [] };

/**
 * Fetch the secrets visible to the current caller in the given org.
 * Returns names + per-scope tagging. Empty payload if the request fails.
 */
export async function fetchVisibleSecrets(orgId: string): Promise<VisibleSecretsResponse> {
  try {
    const r = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/secrets/_visible-names`, {
      credentials: "include",
    });
    if (!r.ok) return EMPTY;
    const j = (await r.json()) as Partial<VisibleSecretsResponse>;
    return {
      names: Array.isArray(j.names) ? j.names : [],
      scoped: Array.isArray(j.scoped) ? j.scoped : [],
    };
  } catch {
    return EMPTY;
  }
}
