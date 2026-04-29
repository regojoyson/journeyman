import { createHash, randomBytes } from "node:crypto";

function envSeconds(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const REFRESH_TTL_SECONDS = envSeconds("REFRESH_TOKEN_TTL_SECONDS", 30 * 24 * 60 * 60);
export const API_TOKEN_PREFIX = "jm_pat_";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function newRefreshToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, hash: sha256(plaintext) };
}

export function newApiToken(): { plaintext: string; hash: string } {
  const plaintext = API_TOKEN_PREFIX + randomBytes(24).toString("base64url");
  return { plaintext, hash: sha256(plaintext) };
}

export function isApiToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}
