import type { WebhookAuthConfig } from "@journeyman/core";
import { constantTimeEqualString } from "./timing-safe.ts";
import type { VerifyInput, VerifyResult } from "./verify.ts";

type HeaderEqualsConfig = Extract<WebhookAuthConfig, { mode: "header-equals" }>;

export function verifyHeaderEquals(
  input: VerifyInput,
  cfg: HeaderEqualsConfig,
  resolvedSecret: string,
): VerifyResult {
  const headerKey = cfg.header.toLowerCase();
  const presented = input.headers[headerKey];
  if (!presented) {
    return { ok: false, reason: `missing header ${cfg.header}` };
  }
  if (!constantTimeEqualString(presented, resolvedSecret)) {
    return { ok: false, reason: "header value mismatch" };
  }
  return { ok: true };
}
