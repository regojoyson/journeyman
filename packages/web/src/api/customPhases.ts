import type {
  CustomAiPhase,
  CustomAiPhaseCreateInput,
  CustomAiPhaseUpdateInput,
} from "@journeyman/core";

const userBase = (orgId: string) => `/api/orgs/${orgId}/users/me/custom-phases`;
const orgBase  = (orgId: string) => `/api/orgs/${orgId}/custom-phases`;

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

export const customPhasesApi = {
  listMine: (orgId: string) =>
    fetch(userBase(orgId), { credentials: "include" }).then(jsonOrThrow<CustomAiPhase[]>),
  listOrg: (orgId: string) =>
    fetch(orgBase(orgId), { credentials: "include" }).then(jsonOrThrow<CustomAiPhase[]>),
  listVisible: (orgId: string) =>
    fetch(`${orgBase(orgId)}/visible`, { credentials: "include" }).then(jsonOrThrow<CustomAiPhase[]>),

  createMine: (orgId: string, body: CustomAiPhaseCreateInput) =>
    fetch(userBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CustomAiPhase>),

  createOrg: (orgId: string, body: CustomAiPhaseCreateInput) =>
    fetch(orgBase(orgId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CustomAiPhase>),

  update: (orgId: string, id: string, scope: "user" | "org", body: CustomAiPhaseUpdateInput) =>
    fetch(
      scope === "user" ? `${userBase(orgId)}/${id}` : `${orgBase(orgId)}/${id}`,
      {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ).then(jsonOrThrow<CustomAiPhase>),

  remove: (orgId: string, id: string, scope: "user" | "org") =>
    fetch(
      scope === "user" ? `${userBase(orgId)}/${id}` : `${orgBase(orgId)}/${id}`,
      { method: "DELETE", credentials: "include" },
    ).then(jsonOrThrow<void>),

  get: (orgId: string, id: string, scope: "user" | "org") =>
    fetch(
      scope === "user" ? `${userBase(orgId)}/${id}` : `${orgBase(orgId)}/${id}`,
      { credentials: "include" },
    ).then(jsonOrThrow<CustomAiPhase>),
};
