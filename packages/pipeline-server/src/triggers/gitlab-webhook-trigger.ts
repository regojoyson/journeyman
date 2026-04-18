import type { FastifyInstance } from "fastify";
import type { ITriggerSource, PipelineTrigger, TriggerMountContext, ProductConfig } from "@journeyman/core";

export class GitLabWebhookTrigger implements ITriggerSource {
  readonly id = "gitlab-webhook";
  constructor(private readonly opts: {
    path?: string;
    defaultSecretEnv?: string;
    ticketKeyRegex?: RegExp;    // default: /([A-Z]+-\d+)/
  }) {}

  mount(app: FastifyInstance, ctx: TriggerMountContext): void {
    const path = this.opts.path ?? "/webhooks/gitlab/:productId";
    const regex = this.opts.ticketKeyRegex ?? /([A-Z]+-\d+)/;

    app.post<{ Params: { productId: string } }>(path, async (req, reply) => {
      const productId = req.params.productId;
      const product = ctx.products[productId];
      if (!product) return reply.code(404).send({ error: `unknown product: ${productId}` });

      const secret = this.resolveSecret(product);
      if (!secret) return reply.code(500).send({ error: "no webhook secret configured" });

      const token = String(req.headers["x-gitlab-token"] ?? "");
      if (!this.constantTimeEqual(token, secret)) {
        return reply.code(401).send({ error: "invalid token" });
      }

      const body = req.body as any;
      const event = String(req.headers["x-gitlab-event"] ?? "");

      // Status-based gating
      const required = product.ticketWorkflow?.trigger?.matchStatus ?? [];
      if (required.length > 0) {
        const state: string | undefined = body?.object_attributes?.state ?? body?.object_attributes?.action;
        if (!state || !required.includes(state)) {
          return reply.code(200).send({ ignored: "status-mismatch" });
        }
      }

      // Extract ticket key from title/description
      const candidates: string[] = [
        body?.object_attributes?.title,
        body?.object_attributes?.description,
        body?.merge_request?.title,
        body?.issue?.title,
      ].filter((v): v is string => typeof v === "string");

      let ticketKey: string | undefined;
      for (const c of candidates) {
        const m = c.match(regex);
        if (m?.[1]) { ticketKey = m[1]; break; }
      }
      if (!ticketKey) return reply.code(200).send({ ignored: "no-ticket" });

      const repoFullName: string | undefined = body?.project?.path_with_namespace;

      ctx.onTrigger({
        sourceId: this.id,
        productId,
        ticketKey,
        ticketShortKey: ticketKey,   // Jira/GitLab-style keys are already short
        rawPayload: this.redact(body, event, repoFullName),
        receivedAt: new Date().toISOString(),
      });
      return reply.code(202).send({ accepted: true });
    });
  }

  private resolveSecret(product: ProductConfig): string | undefined {
    const envName = product.webhookSecrets?.gitlab ?? this.opts.defaultSecretEnv;
    return envName ? process.env[envName] : undefined;
  }

  private constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    const { timingSafeEqual } = require("node:crypto") as typeof import("node:crypto");
    return timingSafeEqual(ba, bb);
  }

  private redact(body: any, event: string, repoFullName: string | undefined): unknown {
    if (!body) return body;
    const { user, ...rest } = body;
    return { ...rest, _event: event, repository: repoFullName ? { full_name: repoFullName } : undefined };
  }
}
