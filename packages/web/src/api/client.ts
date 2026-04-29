// packages/web/src/api/client.ts
import type { SessionManager } from "../auth/SessionManager.js";

const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

let sessionManager: SessionManager | null = null;
export function setApiSessionManager(m: SessionManager | null): void {
  sessionManager = m;
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await doFetch(path, init);

  if (res.status === 401 && sessionManager && !path.includes("/api/auth/")) {
    try {
      await sessionManager.refresh();
      res = await doFetch(path, init);
    } catch {
      // refresh failed — fall through and surface the 401
    }
  }

  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown = body;
    try { parsed = JSON.parse(body); } catch { /* leave as string */ }
    throw new ApiError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

export const conductorUiUrl = (import.meta.env.VITE_CONDUCTOR_UI_URL as string | undefined) ?? "";
