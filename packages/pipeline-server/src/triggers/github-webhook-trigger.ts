/**
 * @file github-webhook-trigger.ts
 * GitHub webhook trigger: POST /webhooks/github/:productId
 *
 * Receives GitHub issue and pull_request events and dispatches a pipeline run when
 * all configured filters pass.
 *
 * Security: verifies the `X-Hub-Signature-256` HMAC-SHA256 header using the product's
 * webhook secret (resolved from the env var named in `product.webhookSecrets.github`
 * or `opts.defaultSecretEnv`). Uses timing-safe comparison to prevent timing attacks.
 *
 * Raw body parsing: registers a content-type parser to capture the raw string before
 * JSON.parse so the HMAC can be computed over the exact bytes GitHub signed.
 *
 * Filtering:
 * - `product.ticketWorkflow.trigger.matchLabels` — if non-empty, the issue must carry
 *   at least one of the listed labels; otherwise the event is ignored (200 ignored).
 *
 * Ticket key: `<repo.full_name>#<issue/PR number>`, e.g. `"myorg/myrepo#42"`.
 * Sender and installation fields are stripped from rawPayload before storage.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ITriggerSource, PipelineTrigger, TriggerMountContext, ProductConfig } from "@journeyman/core";

export class GitHubWebhookTrigger implements ITriggerSource {
  readonly id = "github-webhook";
  constructor(private readonly opts: { path?: string; defaultSecretEnv?: string }) {}

  mount(app: FastifyInstance, ctx: TriggerMountContext): void {
    // Capture raw body so we can HMAC-verify.
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      try {
        const s = body.toString("utf8");
        (_req as any).rawBody = s;
        done(null, JSON.parse(s));
      } catch (err) {
        done(err as Error);
      }
    });

    const path = this.opts.path ?? "/webhooks/github/:productId";
    app.post<{ Params: { productId: string } }>(path, async (req, reply) => {
      const productId = req.params.productId;
      const product = ctx.products[productId];
      if (!product) return reply.code(404).send({ error: `unknown product: ${productId}` });

      const secret = this.resolveSecret(product);
      if (!secret) return reply.code(500).send({ error: "no webhook secret configured" });

      const raw = ((req as any).rawBody as string) ?? "";
      if (!this.verify(req, raw, secret)) {
        return reply.code(401).send({ error: "invalid signature" });
      }

      const event = String(req.headers["x-github-event"] ?? "");
      const body = req.body as any;

      // Label-based gating
      const required = product.ticketWorkflow?.trigger?.matchLabels ?? [];
      if (required.length > 0) {
        const labels: string[] = (body?.issue?.labels ?? [])
          .map((l: any) => (typeof l === "string" ? l : l.name));
        if (!required.some(r => labels.includes(r))) {
          return reply.code(200).send({ ignored: "label-mismatch" });
        }
      }

      const repoFullName = body?.repository?.full_name as string | undefined;
      const number = body?.issue?.number ?? body?.pull_request?.number;
      if (!repoFullName || !number) {
        return reply.code(200).send({ ignored: "no-ticket" });
      }

      const ticketKey = `${repoFullName}#${number}`;
      const ticketShortKey = String(number);

      const action: string | undefined = body?.action;
      let eventType: "new-ticket" | "status-change" | "comment" | undefined;
      let newStatus: string | undefined;

      if (event === "issues") {
        if (action === "labeled" || action === "unlabeled") {
          eventType = "status-change";
          newStatus = body?.label?.name;
        } else if (action === "opened" || action === "reopened") {
          eventType = "new-ticket";
        } else if (action === "created" && body?.comment) {
          eventType = "comment";
        }
      } else if (event === "issue_comment") {
        eventType = "comment";
      } else if (event === "pull_request") {
        if (action === "labeled" || action === "unlabeled") {
          eventType = "status-change";
          newStatus = body?.label?.name;
        }
      }

      ctx.onTrigger({
        sourceId: this.id,
        productId,
        ticketKey,
        ticketShortKey,
        rawPayload: this.redact(body, event),
        receivedAt: new Date().toISOString(),
        eventType,
        newStatus,
      });
      return reply.code(202).send({ accepted: true });
    });
  }

  private resolveSecret(product: ProductConfig): string | undefined {
    const envName = product.webhookSecrets?.github ?? this.opts.defaultSecretEnv;
    return envName ? process.env[envName] : undefined;
  }

  private verify(req: FastifyRequest, raw: string, secret: string): boolean {
    const header = String(req.headers["x-hub-signature-256"] ?? "");
    if (!header.startsWith("sha256=")) return false;
    const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private redact(body: any, event: string): unknown {
    if (!body) return body;
    const { sender, installation, ...rest } = body;
    return { ...rest, _event: event };
  }
}
