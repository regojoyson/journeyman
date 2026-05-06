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

  adminList: () =>
    fetch(`/api/admin/coding-models`, { credentials: "include" })
      .then(jsonOrThrow<CodingModel[]>),

  adminCreate: (body: CodingModelCreateInput) =>
    fetch(`/api/admin/coding-models`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CodingModel>),

  adminUpdate: (id: string, body: CodingModelUpdateInput) =>
    fetch(`/api/admin/coding-models/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CodingModel>),

  adminDelete: (id: string) =>
    fetch(`/api/admin/coding-models/${id}`, {
      method: "DELETE",
      credentials: "include",
    }).then(jsonOrThrow<void>),
};
