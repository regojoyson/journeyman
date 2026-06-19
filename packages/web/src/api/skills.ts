export type SkillInstallStatus = "pending" | "installing" | "ready" | "error";
export type SkillCliType = "claude" | "opencode" | "codex";

export interface SkillPackageRow {
  id: string;
  workspaceId: string;
  orgId: string;
  gitUrl: string;
  name: string;
  localPath?: string;
  commitSha?: string;
  installStatus: SkillInstallStatus;
  installError?: string;
  enabledSkills: string[];
  cliType: SkillCliType;
  createdAt: string;
  updatedAt: string;
}

// Legacy alias for files that reference SkillPackage
export type SkillPackage = SkillPackageRow;

export interface SkillCatalogEntry {
  name: string;
  description: string;
  gitUrl: string;
  author: string;
}

export interface CreateSkillBody {
  gitUrl: string;
  name: string;
  cliType?: SkillCliType;
  shareCloneWith?: string;
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

const wsBase = (wsId: string) => `/api/workspaces/${wsId}/skill-packages`;

export const skillsApi = {
  list: (wsId: string) =>
    fetch(wsBase(wsId), { credentials: "include" }).then(jsonOrThrow<SkillPackageRow[]>),

  catalog: () =>
    fetch("/api/skill-catalog", { credentials: "include" }).then(jsonOrThrow<SkillCatalogEntry[]>),

  create: (wsId: string, body: CreateSkillBody) =>
    fetch(wsBase(wsId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<SkillPackageRow>),

  remove: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),

  updateEnabledSkills: (wsId: string, id: string, enabledSkills: string[]) =>
    fetch(`${wsBase(wsId)}/${id}/enabled-skills`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledSkills }),
    }).then(jsonOrThrow<{ ok: true }>),

  discoverSkills: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/skills`, { credentials: "include" }).then(jsonOrThrow<string[]>),

  findByUrl: async (wsId: string, gitUrl: string): Promise<SkillPackageRow | null> => {
    const r = await fetch(`${wsBase(wsId)}/by-url?url=${encodeURIComponent(gitUrl)}`, { credentials: "include" });
    if (r.status === 404) return null;
    return jsonOrThrow<SkillPackageRow>(r);
  },

  pull: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/pull`, { method: "POST", credentials: "include" })
      .then(jsonOrThrow<{ ok: true }>),
};
