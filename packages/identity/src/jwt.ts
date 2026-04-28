import jwt from "jsonwebtoken";
import type { AccessTokenClaims, Role } from "@journeyman/core";

const ACCESS_TTL_SECONDS = 15 * 60;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET env var missing or shorter than 32 chars");
  }
  return s;
}

export function signAccessToken(input: { userId: string; orgId: string; role: Role }): string {
  return jwt.sign(
    { sub: input.userId, org: input.orgId, role: input.role, kind: "access" },
    secret(),
    { algorithm: "HS256", expiresIn: ACCESS_TTL_SECONDS },
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const claims = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as AccessTokenClaims;
  if (claims.kind !== "access") throw new Error("Wrong token kind");
  return claims;
}

export const ACCESS_TOKEN_TTL_SECONDS = ACCESS_TTL_SECONDS;
