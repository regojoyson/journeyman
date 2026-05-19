// packages/web/src/auth/CookieAuthProvider.ts
import {
  AuthProvider,
  AuthProviderConfig,
  DEFAULT_AUTH_CONFIG,
  Session,
} from "./AuthProvider.js";

interface RawMePayload {
  user?: { id: string; username: string; displayName: string | null; isPlatformAdmin?: boolean };
  activeOrg?: { id: string; slug?: string; name?: string } | null;
  role?: string;
  isPlatformAdmin?: boolean;
  exp?: number; // unix sec
}

function adapt(payload: RawMePayload): Session | null {
  if (!payload.user) return null;
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  return {
    user: {
      sub: payload.user.id,
      preferred_username: payload.user.username,
      name: payload.user.displayName,
      isPlatformAdmin: payload.isPlatformAdmin ?? payload.user.isPlatformAdmin ?? false,
    },
    org: payload.activeOrg
      ? { id: payload.activeOrg.id, slug: payload.activeOrg.slug, name: payload.activeOrg.name }
      : null,
    role: payload.role ?? "",
    exp,
  };
}

export class CookieAuthProvider implements AuthProvider {
  readonly config: AuthProviderConfig;

  constructor(private readonly baseUrl: string = "", config: Partial<AuthProviderConfig> = {}) {
    this.config = { ...DEFAULT_AUTH_CONFIG, ...config };
  }

  async getSession(): Promise<Session | null> {
    const res = await fetch(`${this.baseUrl}/api/auth/me`, { credentials: "include" });
    if (!res.ok) return null;
    return adapt(await res.json() as RawMePayload);
  }

  async refresh(): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const err = new Error(`refresh failed: ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const session = adapt(await res.json() as RawMePayload);
    if (!session) throw new Error("refresh returned no session");
    return session;
  }

  async login(username: string, password: string): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = new Error(`login failed: ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    const session = adapt(await res.json() as RawMePayload);
    if (!session) throw new Error("login returned no session");
    return session;
  }

  async logout(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // swallow — client will clear state regardless
    }
  }
}
