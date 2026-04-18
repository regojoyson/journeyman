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
