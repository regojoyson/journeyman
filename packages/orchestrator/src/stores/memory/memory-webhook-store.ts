import { randomUUID } from "node:crypto";
import type {
  CreateWebhookArgs,
  IWebhookStore,
  UpdateWebhookArgs,
  Webhook,
  WebhookScope,
} from "@journeyman/core";

function scopesEqual(a: WebhookScope, b: WebhookScope): boolean {
  if ("orgId" in a && "orgId" in b) return a.orgId === b.orgId;
  if ("userId" in a && "userId" in b) return a.userId === b.userId;
  return false;
}

export class MemoryWebhookStore implements IWebhookStore {
  private webhooks = new Map<string, Webhook>();

  async create(args: CreateWebhookArgs, tenantToken: string): Promise<Webhook> {
    const now = new Date();
    const webhook: Webhook = {
      id: randomUUID(),
      scope: args.scope,
      name: args.name,
      description: args.description,
      preset: args.preset,
      kind: args.kind,
      tenantToken,
      ingestUrl: "", // populated by route layer; not stored
      auth: args.auth,
      payloadSchema: args.payloadSchema,
      schemaValidation: args.schemaValidation ?? "off",
      schemaInferredFrom: args.schemaInferredFrom,
      eventTypePath: args.eventTypePath,
      deliveryIdHeader: args.deliveryIdHeader,
      correlationSuggestions: args.correlationSuggestions,
      createdAt: now,
      updatedAt: now,
    };
    this.webhooks.set(webhook.id, webhook);
    return webhook;
  }

  async getById(id: string): Promise<Webhook | null> {
    return this.webhooks.get(id) ?? null;
  }

  async getByTenantToken(token: string): Promise<Webhook | null> {
    for (const w of this.webhooks.values()) if (w.tenantToken === token) return w;
    return null;
  }

  async listByScope(scope: WebhookScope): Promise<Webhook[]> {
    return [...this.webhooks.values()]
      .filter((w) => scopesEqual(w.scope, scope))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async update(id: string, patch: UpdateWebhookArgs): Promise<Webhook | null> {
    const current = this.webhooks.get(id);
    if (!current) return null;
    const merged: Webhook = {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description === null ? undefined : (patch.description ?? current.description),
      auth: patch.auth ?? current.auth,
      payloadSchema: patch.payloadSchema === null ? undefined : (patch.payloadSchema ?? current.payloadSchema),
      schemaValidation: patch.schemaValidation ?? current.schemaValidation,
      schemaInferredFrom: patch.schemaInferredFrom === null ? undefined : (patch.schemaInferredFrom ?? current.schemaInferredFrom),
      eventTypePath: patch.eventTypePath === null ? undefined : (patch.eventTypePath ?? current.eventTypePath),
      deliveryIdHeader: patch.deliveryIdHeader === null ? undefined : (patch.deliveryIdHeader ?? current.deliveryIdHeader),
      correlationSuggestions: patch.correlationSuggestions === null ? undefined : (patch.correlationSuggestions ?? current.correlationSuggestions),
      updatedAt: new Date(),
    };
    this.webhooks.set(id, merged);
    return merged;
  }

  async rotateToken(id: string, newTenantToken: string): Promise<Webhook | null> {
    const current = this.webhooks.get(id);
    if (!current) return null;
    const merged: Webhook = {
      ...current,
      tenantToken: newTenantToken,
      rotatedAt: new Date(),
      updatedAt: new Date(),
    };
    this.webhooks.set(id, merged);
    return merged;
  }

  async touchLastEvent(id: string): Promise<void> {
    const current = this.webhooks.get(id);
    if (!current) return;
    this.webhooks.set(id, { ...current, lastEventAt: new Date() });
  }

  async delete(id: string): Promise<boolean> {
    return this.webhooks.delete(id);
  }
}
