import type { ModelPricing, ModelPricingCreateInput, ModelPricingUpdateInput } from "@journeyman/core";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const modelPricingApi = {
  orgList: (orgId: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing`, { credentials: "include" })
      .then(jsonOrThrow<ModelPricing[]>),
  orgCreate: (orgId: string, body: ModelPricingCreateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(jsonOrThrow<ModelPricing>),
  orgUpdate: (orgId: string, id: string, body: ModelPricingUpdateInput) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(jsonOrThrow<ModelPricing>),
  orgDelete: (orgId: string, id: string) =>
    fetch(`/api/orgs/${encodeURIComponent(orgId)}/model-pricing/${id}`, {
      method: "DELETE", credentials: "include",
    }).then(jsonOrThrow<void>),
};
