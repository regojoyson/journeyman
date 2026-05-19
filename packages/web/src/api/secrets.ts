export type SecretScope = "user" | "org" | "global";

export interface VisibleSecret { name: string; scope: SecretScope }

export async function fetchVisibleSecrets(orgId: string): Promise<VisibleSecret[]> {
  const r = await fetch(`/api/orgs/${orgId}/secrets/_visible-names`, { credentials: "include" });
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
