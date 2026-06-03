import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import type { OperationRunner } from "@journeyman/core";
import type { IDockerClient } from "./backends/docker/docker-client.ts";
import { createDefaultRegistry } from "./default-registry.ts";
import { WORKER_TYPE_CATALOG } from "./worker-type-catalog.ts";

const runOperation: OperationRunner = async () => ({ ok: true });
const client = {} as IDockerClient;

describe("WORKER_TYPE_CATALOG", () => {
  it("has a unique entry per type", () => {
    const types = WORKER_TYPE_CATALOG.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("matches every registered backend (no drift)", () => {
    const registry = createDefaultRegistry({
      runOperation, defaultBaseDir: tmpdir(),
      docker: { client, defaultImage: "journeyman/runner-base:dev" },
    });
    for (const type of registry.available()) {
      const backend = registry.get(type);
      const entry = WORKER_TYPE_CATALOG.find((d) => d.type === type);
      expect(entry, `catalog missing entry for '${type}'`).toBeDefined();
      expect(entry!.status).toBe("available");
      expect([...entry!.supportedModes].sort()).toEqual([...backend.supportedModes].sort());
      expect([...entry!.supportedConnectivity].sort()).toEqual([...backend.supportedConnectivity].sort());
    }
  });
});
