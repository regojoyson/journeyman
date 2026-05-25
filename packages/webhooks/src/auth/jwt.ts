import { createRemoteJWKSet, jwtVerify, type JWTVerifyOptions } from "jose";
import type { WebhookAuthConfig } from "@journeyman/core";
import type { VerifyInput, VerifyResult } from "./verify.ts";

type JwtConfig = Extract<WebhookAuthConfig, { mode: "jwt" }>;

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  let entry = jwksCache.get(url);
  if (!entry) {
    entry = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: 60 * 60 * 1000, // 1h
      cooldownDuration: 30 * 1000, // 30s between refetches on key miss
    });
    jwksCache.set(url, entry);
  }
  return entry;
}

export async function verifyJwt(
  input: VerifyInput,
  cfg: JwtConfig,
  resolvedSigningKey: string | null,
): Promise<VerifyResult> {
  const headerKey = cfg.header.toLowerCase();
  let token = input.headers[headerKey];
  if (!token) {
    return { ok: false, reason: `missing header ${cfg.header}` };
  }
  if (cfg.stripPrefix && token.startsWith(cfg.stripPrefix)) {
    token = token.slice(cfg.stripPrefix.length);
  }

  const options: JWTVerifyOptions = { algorithms: [cfg.algo] };
  if (cfg.expectedIssuer) options.issuer = cfg.expectedIssuer;
  if (cfg.expectedAudience) options.audience = cfg.expectedAudience;

  try {
    if (cfg.algo === "HS256") {
      if (!resolvedSigningKey) {
        return { ok: false, reason: "HS256 requires signingKeyRef" };
      }
      const keyBytes = new TextEncoder().encode(resolvedSigningKey);
      await jwtVerify(token, keyBytes, options);
    } else {
      if (!cfg.jwksUrl) {
        return { ok: false, reason: `${cfg.algo} requires jwksUrl` };
      }
      const jwks = getJwks(cfg.jwksUrl);
      await jwtVerify(token, jwks, options);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "jwt verify failed" };
  }
}
