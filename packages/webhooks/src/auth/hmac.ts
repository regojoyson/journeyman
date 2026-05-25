import { createHmac } from "node:crypto";
import type { WebhookAuthConfig } from "@journeyman/core";
import { constantTimeEqualEncoded } from "./timing-safe.ts";
import type { VerifyInput, VerifyResult } from "./verify.ts";

type HmacConfig = Extract<WebhookAuthConfig, { mode: "hmac" }>;

export function verifyHmac(
  input: VerifyInput,
  cfg: HmacConfig,
  resolvedSecret: string,
): VerifyResult {
  const headerKey = cfg.header.toLowerCase();
  const presented = input.headers[headerKey];
  if (!presented) {
    return { ok: false, reason: `missing header ${cfg.header}` };
  }

  // Strip provider prefix if configured (e.g. "sha256=").
  let candidate = presented;
  if (cfg.prefix && candidate.startsWith(cfg.prefix)) {
    candidate = candidate.slice(cfg.prefix.length);
  }

  // Build the signed string.
  let signed: string;
  if (cfg.timestamp) {
    const tsKey = cfg.timestamp.header.toLowerCase();
    const ts = input.headers[tsKey];
    if (!ts) {
      return { ok: false, reason: `missing timestamp header ${cfg.timestamp.header}` };
    }
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) {
      return { ok: false, reason: "timestamp not numeric" };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - tsNum) > cfg.timestamp.toleranceSeconds) {
      return { ok: false, reason: "timestamp outside tolerance" };
    }
    signed = cfg.timestamp.signedFormat
      .replace("{timestamp}", ts)
      .replace("{body}", input.rawBody.toString("utf8"));
  } else {
    signed = input.rawBody.toString("utf8");
  }

  const computed = createHmac(cfg.algo, resolvedSecret)
    .update(signed, "utf8")
    .digest(cfg.encoding);

  if (!constantTimeEqualEncoded(candidate, computed, cfg.encoding)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
