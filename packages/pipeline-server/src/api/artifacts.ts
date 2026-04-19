/**
 * @file artifacts.ts
 * GET /api/runs/:sessionId/artifacts/:key — download an artifact blob by key.
 *
 * Loads the run from state, performs a deep search through `run.artifacts` for an
 * `ArtifactHandle` whose `key` matches the path parameter, then streams the file
 * from the artifact store with the correct `content-type` and `content-length` headers.
 *
 * The deep search (`findHandle`) handles artifacts nested inside phase result objects
 * (e.g. `analysis.reportHandle`, `plan.reportHandle`) without callers needing to know
 * the exact nesting structure.
 *
 * Returns 404 if the run does not exist or if no handle with the given key is found.
 */

import type { FastifyInstance } from "fastify";
import type { ArtifactHandle, IArtifactStore, IStateStore } from "@journeyman/core";

export type ArtifactsApiDeps = { state: IStateStore; artifactStore: IArtifactStore };

export function registerArtifactsApi(app: FastifyInstance, deps: ArtifactsApiDeps) {
  app.get<{ Params: { sessionId: string; key: string } }>(
    "/api/runs/:sessionId/artifacts/:key",
    async (req, reply) => {
      const run = await deps.state.load(req.params.sessionId);
      if (!run) return reply.code(404).send({ error: "run not found" });

      const handle = findHandle(run.artifacts, req.params.key);
      if (!handle) return reply.code(404).send({ error: `no artifact "${req.params.key}"` });

      const buf = await deps.artifactStore.get(handle);
      reply.header("content-type", handle.contentType ?? "application/octet-stream");
      reply.header("content-length", String(handle.size));
      return reply.send(buf);
    },
  );
}

function findHandle(obj: unknown, key: string): ArtifactHandle | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o.kind === "artifact" && o.key === key) return o as unknown as ArtifactHandle;
  for (const v of Object.values(o)) {
    const hit = findHandle(v, key);
    if (hit) return hit;
  }
  return null;
}
