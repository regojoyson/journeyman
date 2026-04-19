/**
 * @file jira-webhook-trigger.ts
 * Jira webhook trigger: POST /webhooks/jira/:productId
 *
 * Receives Jira issue events (typically `jira:issue_updated`) and dispatches a pipeline
 * run when the configured status transition filter passes.
 *
 * Security: validates the `Authorization: Bearer <token>` header against the product's
 * webhook secret (env var from `product.webhookSecrets.jira` or `opts.defaultSecretEnv`).
 * Jira webhooks do not sign payloads, so bearer token auth is the only verification.
 *
 * Filtering:
 * - `product.ticketWorkflow.trigger.matchStatus` — if non-empty, the event must include
 *   a changelog item with `field: "status"` whose `toString` matches one of the listed
 *   values. Events without a status transition or that don't match are ignored (200).
 *
 * Ticket key: taken directly from `body.issue.key` (e.g. "EV-123"). Jira keys are
 * already short, so `ticketShortKey === ticketKey`.
 *
 * User fields are stripped from rawPayload before storage.
 */

import type { FastifyInstance } from "fastify";
import type { ITriggerSource, PipelineTrigger, TriggerMountContext, ProductConfig } from "@journeyman/core";

export class JiraWebhookTrigger implements ITriggerSource {
  readonly id = "jira-webhook";
  constructor(private readonly opts: { path?: string; defaultSecretEnv?: string }) {}

  mount(app: FastifyInstance, ctx: TriggerMountContext): void {
    const path = this.opts.path ?? "/webhooks/jira/:productId";

    app.post<{ Params: { productId: string } }>(path, async (req, reply) => {
      const productId = req.params.productId;
      const product = ctx.products[productId];
      if (!product) return reply.code(404).send({ error: `unknown product: ${productId}` });

      const secret = this.resolveSecret(product);
      if (!secret) return reply.code(500).send({ error: "no webhook secret configured" });

      if (req.headers.authorization !== `Bearer ${secret}`) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const body = req.body as any;
      const key = body?.issue?.key;
      if (!key) return reply.code(200).send({ ignored: "no-ticket" });

      // Status-transition gating via changelog
      const required = product.ticketWorkflow?.trigger?.matchStatus ?? [];
      if (required.length > 0) {
        const items: any[] = body?.changelog?.items ?? [];
        const statusItem = items.find(i => i.field === "status");
        const toStatus = statusItem?.toString;
        if (!toStatus || !required.includes(toStatus)) {
          return reply.code(200).send({ ignored: "status-mismatch" });
        }
      }

      ctx.onTrigger({
        sourceId: this.id,
        productId,
        ticketKey: key,
        ticketShortKey: key,         // Jira keys are already short
        rawPayload: this.redact(body),
        receivedAt: new Date().toISOString(),
      });
      return reply.code(202).send({ accepted: true });
    });
  }

  private resolveSecret(product: ProductConfig): string | undefined {
    const envName = product.webhookSecrets?.jira ?? this.opts.defaultSecretEnv;
    return envName ? process.env[envName] : undefined;
  }

  private redact(body: any): unknown {
    if (!body) return body;
    const { user, ...rest } = body;
    return rest;
  }
}
