import type {
  CodingModel,
  CodingModelCreateInput,
  CodingModelUpdateInput,
} from "@journeyman/core";

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

export const codingModelsApi = {
  list: (provider: string) =>
    fetch(`/api/coding-models?provider=${encodeURIComponent(provider)}`, { credentials: "include" })
      .then(jsonOrThrow<CodingModel[]>),

  orgList: (orgId: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models`, { credentials: "include" })
      .then(jsonOrThrow<CodingModel[]>),

  orgCreate: (orgId: string, body: CodingModelCreateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CodingModel>),

  orgUpdate: (orgId: string, id: string, body: CodingModelUpdateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CodingModel>),

  orgDelete: (orgId: string, id: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/coding-models/${id}`, {
      method: "DELETE",
      credentials: "include",
    }).then(jsonOrThrow<void>),
};
