import type { FastifyInstance } from "fastify";
import type { PipelineEvent } from "@journeyman/core";

export type EventBusLike = {
  subscribe(sessionId: string, listener: (e: PipelineEvent) => void): () => void;
  replay(sessionId: string): PipelineEvent[];
};

export type StreamApiDeps = { bus: EventBusLike };

export function registerStreamApi(app: FastifyInstance, deps: StreamApiDeps) {
  app.get<{ Params: { sessionId: string } }>("/api/runs/:sessionId/stream", async (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    let id = 0;
    for (const e of deps.bus.replay(req.params.sessionId)) {
      reply.raw.write(`id: ${++id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    }
    const off = deps.bus.subscribe(req.params.sessionId, (e: PipelineEvent) => {
      reply.raw.write(`id: ${++id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    req.raw.on("close", () => { off(); reply.raw.end(); });
    return new Promise<void>(() => {});
  });
}
