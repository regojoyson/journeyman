// Same-origin default. Set VITE_API_BASE_URL in .env.development for local dev,
// or leave empty in production so requests use relative paths (reverse-proxied).
const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    let parsed: unknown = body;
    try { parsed = JSON.parse(body); } catch { /* leave as string */ }
    throw new ApiError(res.status, parsed);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

// Conductor UI is a separate service; URL must be configured per environment via VITE_CONDUCTOR_UI_URL.
export const conductorUiUrl = (import.meta.env.VITE_CONDUCTOR_UI_URL as string | undefined) ?? "";
