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
