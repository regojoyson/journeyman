import { api } from "./client.ts";

export type SecretScope = "user" | "org" | "global";

export interface VisibleSecret { name: string; scope: SecretScope }

export async function fetchVisibleSecrets(wsId: string): Promise<VisibleSecret[]> {
  if (!wsId) return [];
  const r = await fetch(`/api/workspaces/${wsId}/secrets/_visible-names`, { credentials: "include" });
  if (!r.ok) return [];
  const body = await r.json();
  return Array.isArray(body?.scoped) ? body.scoped : [];
}

export function filterSecrets(
  secrets: VisibleSecret[],
  mode: "all" | "org-and-global",
): VisibleSecret[] {
  if (mode === "all") return secrets;
  return secrets.filter((s) => s.scope !== "user");
}

export interface OrgSecretMeta { id: string; name: string; description?: string | null }

/** List org-scope secrets (admin only). Returns metadata, never values. */
export function listOrgSecrets(orgId: string): Promise<OrgSecretMeta[]> {
  return api<OrgSecretMeta[]>(`/api/orgs/${encodeURIComponent(orgId)}/secrets`);
}

/**
 * Create an org-scope secret. Caller must be org admin (backend returns 403 otherwise).
 */
export function createOrgSecret(
  orgId: string,
  name: string,
  value: string,
  description?: string,
): Promise<{ id: string; name: string }> {
  return api<{ id: string; name: string }>(
    `/api/orgs/${encodeURIComponent(orgId)}/secrets`,
    { method: "POST", body: JSON.stringify({ name, value, description }) },
  );
}

/**
 * Create a user-scope secret. Pinned to active org per existing MySecretsPage pattern.
 */
export function createUserSecret(
  orgId: string,
  name: string,
  value: string,
  description?: string,
): Promise<{ id: string; name: string }> {
  return api<{ id: string; name: string }>(
    `/api/orgs/${encodeURIComponent(orgId)}/users/me/secrets`,
    { method: "POST", body: JSON.stringify({ name, value, description }) },
  );
}

/**
 * Promote a user-scope secret with the given name to org-scope. Admin-only.
 */
export function promoteSecretToOrg(
  orgId: string,
  secretName: string,
): Promise<{ id: string; name: string }> {
  return api<{ id: string; name: string }>(
    `/api/orgs/${encodeURIComponent(orgId)}/secrets/${encodeURIComponent(secretName)}/promote-from-user`,
    { method: "POST", body: "{}" },
  );
}

/**
 * Build a sensible default secret name from a preset id.
 *   "github"         → "GITHUB_WEBHOOK_SECRET"
 *   "github-issues"  → "GITHUB_ISSUES_WEBHOOK_SECRET"
 */
export function secretNameSuggestion(presetId: string): string {
  const base = presetId.toUpperCase().replace(/-/g, "_");
  return `${base}_WEBHOOK_SECRET`;
}
