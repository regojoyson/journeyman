/**
 * @file api-trigger.ts
 * Direct HTTP trigger: POST /api/trigger/:productId
 *
 * Allows external systems to start a pipeline run by calling the API directly,
 * bypassing the webhook layer. The request must supply a bearer token matching
 * the server's configured token.
 *
 * Request body: `{ ticketKey: string, ticketShortKey?: string, flowName?: string }`
 *
 * The trigger performs:
 * - Bearer token validation (own check, not the global middleware).
 * - Product existence check against the loaded product config.
 * - Payload validation via Zod.
 * - `ticketShortKey` derivation from `ticketKey` when omitted (extracts `#<number>`).
 * - Authorization header is stripped from `rawPayload` before storage.
 *
 * Returns 202 Accepted immediately; the run executes asynchronously.
 */

import type { FastifyInstance } from "fastify";
import type { ITriggerSource, PipelineTrigger, TriggerMountContext } from "@journeyman/core";
import { z } from "zod";

export class ApiTrigger implements ITriggerSource {
  readonly id = "api";
  constructor(private readonly opts: { bearerToken: string }) {}

  mount(app: FastifyInstance, ctx: TriggerMountContext): void {
    const Body = z.object({
      ticketKey: z.string().min(1),
      ticketShortKey: z.string().optional(),
      flowName: z.string().optional(),
    });

    app.post<{ Params: { productId: string } }>(
      "/api/trigger/:productId",
      async (req, reply) => {
        if (req.headers.authorization !== `Bearer ${this.opts.bearerToken}`) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        const parsed = Body.safeParse(req.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.message });
        }
        const productId = req.params.productId;
        if (!ctx.products[productId]) {
          return reply.code(404).send({ error: `unknown product: ${productId}` });
        }
        const trigger: PipelineTrigger = {
          sourceId: this.id,
          productId,
          ticketKey: parsed.data.ticketKey,
          ticketShortKey: parsed.data.ticketShortKey ?? deriveShortKey(parsed.data.ticketKey),
          flowName: parsed.data.flowName,
          rawPayload: redact(req.body),
          receivedAt: new Date().toISOString(),
        };
        ctx.onTrigger(trigger);
        return reply.code(202).send({ accepted: true });
      },
    );
  }
}

function deriveShortKey(key: string): string {
  const m = key.match(/#(\d+)$/);   // "owner/repo#42" → "42"
  return m ? m[1]! : key;
}

function redact(b: unknown): unknown {
  if (!b || typeof b !== "object") return b;
  const copy = { ...(b as Record<string, unknown>) };
  delete copy.Authorization;
  delete copy.authorization;
  return copy;
}
