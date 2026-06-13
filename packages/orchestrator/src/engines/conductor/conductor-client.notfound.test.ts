import { describe, it, expect, vi } from "vitest";
import { ConductorClient, ConductorHttpError } from "./conductor-client.ts";

/**
 * A Conductor 404 for a workflow id means the engine no longer knows the run
 * (e.g. its storage was reset). getWorkflow surfaces that as `null` so the
 * orchestrator can reconcile the orphan to terminal — but any non-404 error is
 * a real failure and must still throw so the syncer keeps retrying.
 */
function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ConductorClient.getWorkflow not-found handling", () => {
  it("returns null when Conductor 404s the workflow id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response(404, { status: 404, message: "No such workflow found by id: x" }),
    );
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    const result = await client.getWorkflow("missing-id");

    expect(result).toBeNull();
  });

  it("throws (does not swallow) a non-404 error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response(503, { status: 503, message: "service unavailable" }),
    );
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    await expect(client.getWorkflow("some-id")).rejects.toBeInstanceOf(ConductorHttpError);
  });
});
