import type { FastifyReply } from "fastify";

/**
 * Tiny SSE writer. Call openSseStream() once per request, then send() per event.
 * Closes when client disconnects or close() is called.
 */
export interface SseStream {
  send(event: { id?: number | string; event?: string; data: unknown }): void;
  ping(): void;
  close(): Promise<void>;
}

export function openSseStream(reply: FastifyReply): SseStream {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.flushHeaders?.();

  let closed = false;

  const send = (e: { id?: number | string; event?: string; data: unknown }) => {
    if (closed) return;
    let buf = "";
    if (e.id !== undefined) buf += `id: ${e.id}\n`;
    if (e.event) buf += `event: ${e.event}\n`;
    buf += `data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`;
    reply.raw.write(buf);
  };

  const ping = () => {
    if (closed) return;
    reply.raw.write(`: ping\n\n`);
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    reply.raw.end();
  };

  reply.raw.on("close", () => { closed = true; });

  return { send, ping, close };
}
