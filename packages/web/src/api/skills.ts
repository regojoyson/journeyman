export type SkillInstallStatus = "pending" | "installing" | "ready" | "error";
export type SkillCliType = "claude" | "opencode" | "codex";

export interface SkillPackage {
  id: string;
  scope: "user" | "org";
  userId?: string;
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

export interface SkillCatalogEntry {
  name: string;
  description: string;
  gitUrl: string;
  author: string;
}

export interface PromotableSkillRow {
  id: string;
  name: string;
  gitUrl: string;
  ownerId: string;
  ownerEmail: string;
  enabledSkillCount: number;
  updatedAt: string;
}

export interface CreateSkillBody {
  gitUrl: string;
  name: string;
  cliType?: SkillCliType;
}

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/skill-packages`;
const orgBase = (orgId: string) => `/api/orgs/${orgId}/skill-packages`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) return r.json() as Promise<T>;
  const body = await r.json().catch(() => ({}));
  throw new Error(body?.error ?? `HTTP ${r.status}`);
}

export const skillsApi = {
  listMy: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<SkillPackage[]>),

  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<SkillPackage[]>),

  listPromotable: (orgId: string) =>
    fetch(`${orgBase(orgId)}/promotable`, { credentials: "include" }).then(
      jsonOrThrow<PromotableSkillRow[]>,
    ),

  catalog: () =>
    fetch("/api/skill-catalog", { credentials: "include" }).then(
      jsonOrThrow<SkillCatalogEntry[]>,
    ),

  createMy: (orgId: string, body: CreateSkillBody) =>
    fetch(userBase(orgId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<SkillPackage>),

  createOrg: (orgId: string, body: CreateSkillBody) =>
    fetch(orgBase(orgId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<SkillPackage>),

  removeMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(
      jsonOrThrow<{ ok: true }>,
    ),

  removeOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}`, { method: "DELETE", credentials: "include" }).then(
      jsonOrThrow<{ ok: true }>,
    ),

  updateEnabledSkillsMy: (orgId: string, id: string, enabledSkills: string[]) =>
    fetch(`${userBase(orgId)}/${id}/enabled-skills`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledSkills }),
    }).then(jsonOrThrow<{ ok: true }>),

  updateEnabledSkillsOrg: (orgId: string, id: string, enabledSkills: string[]) =>
    fetch(`${orgBase(orgId)}/${id}/enabled-skills`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabledSkills }),
    }).then(jsonOrThrow<{ ok: true }>),

  discoverSkillsMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}/skills`, { credentials: "include" }).then(
      jsonOrThrow<string[]>,
    ),

  discoverSkillsOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/skills`, { credentials: "include" }).then(
      jsonOrThrow<string[]>,
    ),

  pullMy: (orgId: string, id: string) =>
    fetch(`${userBase(orgId)}/${id}/pull`, {
      method: "POST",
      credentials: "include",
    }).then(jsonOrThrow<{ ok: true }>),

  pullOrg: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/pull`, {
      method: "POST",
      credentials: "include",
    }).then(jsonOrThrow<{ ok: true }>),

  promote: (orgId: string, id: string) =>
    fetch(`${orgBase(orgId)}/${id}/promote`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(jsonOrThrow<SkillPackage>),
};
