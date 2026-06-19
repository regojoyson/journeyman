import type {
  CustomAiStep,
  CustomAiStepCreateInput,
  CustomAiStepUpdateInput,
} from "@journeyman/core";

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (r.ok) {
    if (r.status === 204) return undefined as T;
    return r.json() as Promise<T>;
  }
  const body = await r.json().catch(() => ({}));
  throw new Error((body as any)?.error ?? `HTTP ${r.status}`);
}

const wsBase = (wsId: string) => `/api/workspaces/${wsId}/custom-steps`;

export const customStepsApi = {
  list: (wsId: string) =>
    fetch(wsBase(wsId), { credentials: "include" }).then(jsonOrThrow<CustomAiStep[]>),

  create: (wsId: string, body: CustomAiStepCreateInput) =>
    fetch(wsBase(wsId), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CustomAiStep>),

  update: (wsId: string, id: string, body: CustomAiStepUpdateInput) =>
    fetch(`${wsBase(wsId)}/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CustomAiStep>),

  remove: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { method: "DELETE", credentials: "include" })
      .then(jsonOrThrow<void>),

  get: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}`, { credentials: "include" }).then(jsonOrThrow<CustomAiStep>),

  exportOne: async (wsId: string, id: string) => {
    const r = await fetch(`${wsBase(wsId)}/${id}/export`, { credentials: "include" });
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error((b as any)?.error ?? `HTTP ${r.status}`); }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") ?? "";
    const m = /filename="([^"]+)"/.exec(cd);
    const filename = m?.[1] ?? "custom-step.json";
    const a = document.createElement("a"); const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(objectUrl);
  },

  importOne: (wsId: string, body: unknown) =>
    fetch(`${wsBase(wsId)}/import`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(jsonOrThrow<CustomAiStep>),
};
