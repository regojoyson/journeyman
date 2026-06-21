import { createHmac } from "node:crypto";
import type { Webhook, WebhookAuthConfig } from "@journeyman/core";

/**
 * Build a HTTP header set for a test event that would pass the given webhook's
 * auth check. Returns null if the auth mode is not synthesizable client-side
 * (e.g. JWT — needs `jose.SignJWT` and we don't synthesize tokens in v1).
 */
export function buildTestDeliveryHeaders(
  webhook: Webhook,
  rawBody: Buffer,
  resolvedSecret: string | null,
): Record<string, string> | null {
  const auth: WebhookAuthConfig = webhook.auth;

  switch (auth.mode) {
    case "none":
      return { "content-type": "application/json" };

    case "header-equals":
      if (!resolvedSecret) return null;
      return {
        "content-type": "application/json",
        [auth.header]: resolvedSecret,
      };

    case "hmac": {
      if (!resolvedSecret) return null;
      let signed = rawBody.toString("utf8");
      const out: Record<string, string> = { "content-type": "application/json" };
      if (auth.timestamp) {
        const ts = Math.floor(Date.now() / 1000).toString();
        out[auth.timestamp.header] = ts;
        signed = auth.timestamp.signedFormat
          .replace("{timestamp}", ts)
          .replace("{body}", rawBody.toString("utf8"));
      }
      const digest = createHmac(auth.algo, resolvedSecret).update(signed, "utf8").digest(auth.encoding);
      out[auth.header] = `${auth.prefix ?? ""}${digest}`;
      return out;
    }

    case "jwt":
      // Out of scope for v1: synthesizing a valid HS/RS/ES token. Route returns 501.
      return null;
  }
}

/**
 * For a sample-event test fire, derive the event-type header a header-based
 * provider expects (e.g. GitHub's `x-github-event`). Returns null when the
 * provider reads its event type from the body (e.g. `$.webhookEvent`) or when
 * no sample key was chosen — in those cases the body already carries the type.
 */
export function eventTypeHeaderForSample(
  eventTypePath: string | undefined,
  sampleEvent: string | undefined,
): { name: string; value: string } | null {
  if (!sampleEvent || !eventTypePath || !eventTypePath.startsWith("header:")) return null;
  return { name: eventTypePath.slice("header:".length).toLowerCase(), value: sampleEvent };
}
