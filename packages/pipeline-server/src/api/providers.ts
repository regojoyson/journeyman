/**
 * @file providers.ts
 * GET /api/providers — list all registered providers grouped by category.
 *
 * Returns `{ "coding-cli": IProviderMeta[], git: IProviderMeta[], ticket: IProviderMeta[],
 * notification: IProviderMeta[] }`. Each entry includes the provider's id, name, and
 * description from its static `meta` property. Useful for verifying registration and
 * for building admin UIs that enumerate available integrations.
 */

import type { FastifyInstance } from "fastify";
import type { IProviderMeta } from "@journeyman/core";

export type ProvidersApiDeps = {
  providers: { listByCategory(c: IProviderMeta["category"]): IProviderMeta[] };
};

export function registerProvidersApi(app: FastifyInstance, deps: ProvidersApiDeps) {
  app.get("/api/providers", async () => ({
    "coding-cli": deps.providers.listByCategory("coding-cli"),
    git: deps.providers.listByCategory("git"),
    ticket: deps.providers.listByCategory("ticket"),
    notification: deps.providers.listByCategory("notification"),
  }));
}
