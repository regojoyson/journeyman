/**
 * @file products.ts
 * GET /api/products — list product IDs configured in pipeline.yaml.
 */

import type { FastifyInstance } from "fastify";
import type { PipelineConfig } from "@journeyman/core";

export type ProductsApiDeps = { config: PipelineConfig };

export function registerProductsApi(app: FastifyInstance, deps: ProductsApiDeps) {
  app.get("/api/products", async () => {
    return Object.entries(deps.config.products)
      .map(([id, cfg]) => ({ id, flow: cfg.flow }))
      .sort((a, b) => a.id.localeCompare(b.id));
  });
}
