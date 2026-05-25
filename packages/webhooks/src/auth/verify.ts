import type { WebhookAuthConfig } from "@journeyman/core";
import { verifyNone } from "./none.ts";
import { verifyHeaderEquals } from "./header-equals.ts";
import { verifyHmac } from "./hmac.ts";
import { verifyJwt } from "./jwt.ts";

export type VerifyInput = {
  /** Lowercased header names → values. Multi-value headers joined with ", ". */
  headers: Record<string, string>;
  /** Raw request body, unparsed, for signature reconstruction. */
  rawBody: Buffer;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify an inbound webhook request per its auth config. The caller must
 * resolve any secret/key reference and pass the plaintext as `resolvedSecret`.
 * For `none`, pass `null`.
 */
export async function verifyWebhookRequest(
  input: VerifyInput,
  auth: WebhookAuthConfig,
  resolvedSecret: string | null,
): Promise<VerifyResult> {
  switch (auth.mode) {
    case "none":
      return verifyNone(input);
    case "header-equals":
      if (!resolvedSecret) return { ok: false, reason: "missing secret" };
      return verifyHeaderEquals(input, auth, resolvedSecret);
    case "hmac":
      if (!resolvedSecret) return { ok: false, reason: "missing secret" };
      return verifyHmac(input, auth, resolvedSecret);
    case "jwt":
      // resolvedSecret may be null for asymmetric (RS256/ES256) — verifier handles it.
      return verifyJwt(input, auth, resolvedSecret);
  }
}
