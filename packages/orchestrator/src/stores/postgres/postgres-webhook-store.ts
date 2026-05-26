import type { Pool } from "pg";
import type {
  CreateWebhookArgs,
  IWebhookStore,
  UpdateWebhookArgs,
  Webhook,
  WebhookScope,
} from "@journeyman/core";

function rowToWebhook(row: any): Webhook {
  const scope: WebhookScope = row.org_id
    ? { orgId: row.org_id }
    : { userId: row.user_id };
  return {
    id: row.id,
    scope,
    name: row.name,
    description: row.description ?? undefined,
    preset: row.preset,
    kind: row.kind,
    tenantToken: row.tenant_token,
    ingestUrl: "", // populated by route layer; not stored
    auth: row.auth,
    payloadSchema: row.payload_schema ?? undefined,
    schemaValidation: row.schema_validation,
    schemaInferredFrom: row.schema_inferred_from ?? undefined,
    eventTypePath: row.event_type_path ?? undefined,
    deliveryIdHeader: row.delivery_id_header ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    rotatedAt: row.rotated_at ? new Date(row.rotated_at) : undefined,
    lastEventAt: row.last_event_at ? new Date(row.last_event_at) : undefined,
  };
}

export class PostgresWebhookStore implements IWebhookStore {
  constructor(private pool: Pool) {}

  async create(args: CreateWebhookArgs, tenantToken: string): Promise<Webhook> {
    const orgId = "orgId" in args.scope ? args.scope.orgId : null;
    const userId = "userId" in args.scope ? args.scope.userId : null;
    const { rows } = await this.pool.query(
      `INSERT INTO jm_webhooks
         (org_id, user_id, name, description, preset, kind, tenant_token,
          auth, payload_schema, schema_validation, schema_inferred_from,
          event_type_path, delivery_id_header)
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               $8::jsonb,$9::jsonb,$10,$11::jsonb,
               $12,$13)
       RETURNING *`,
      [
        orgId, userId, args.name, args.description ?? null,
        args.preset, args.kind, tenantToken,
        JSON.stringify(args.auth),
        args.payloadSchema == null ? null : JSON.stringify(args.payloadSchema),
        args.schemaValidation ?? "off",
        args.schemaInferredFrom == null ? null : JSON.stringify(args.schemaInferredFrom),
        args.eventTypePath ?? null,
        args.deliveryIdHeader ?? null,
      ],
    );
    return rowToWebhook(rows[0]);
  }

  async getById(id: string): Promise<Webhook | null> {
    const { rows } = await this.pool.query("SELECT * FROM jm_webhooks WHERE id = $1", [id]);
    return rows[0] ? rowToWebhook(rows[0]) : null;
  }

  async getByTenantToken(token: string): Promise<Webhook | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_webhooks WHERE tenant_token = $1",
      [token],
    );
    return rows[0] ? rowToWebhook(rows[0]) : null;
  }

  async listByScope(scope: WebhookScope): Promise<Webhook[]> {
    const orgId = "orgId" in scope ? scope.orgId : null;
    const userId = "userId" in scope ? scope.userId : null;
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_webhooks
       WHERE ($1::uuid IS NOT NULL AND org_id  = $1::uuid)
          OR ($2::uuid IS NOT NULL AND user_id = $2::uuid)
       ORDER BY created_at ASC`,
      [orgId, userId],
    );
    return rows.map(rowToWebhook);
  }

  async update(id: string, patch: UpdateWebhookArgs): Promise<Webhook | null> {
    // Dynamic SQL — only set fields the caller actually sent.
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    const add = (col: string, val: unknown, cast = "") => {
      sets.push(`${col} = $${idx}${cast}`);
      values.push(val);
      idx++;
    };
    if (patch.name !== undefined) add("name", patch.name);
    if (patch.description !== undefined) add("description", patch.description);
    if (patch.auth !== undefined) add("auth", JSON.stringify(patch.auth), "::jsonb");
    if (patch.payloadSchema !== undefined) add("payload_schema", patch.payloadSchema == null ? null : JSON.stringify(patch.payloadSchema), "::jsonb");
    if (patch.schemaValidation !== undefined) add("schema_validation", patch.schemaValidation);
    if (patch.schemaInferredFrom !== undefined) add("schema_inferred_from", patch.schemaInferredFrom == null ? null : JSON.stringify(patch.schemaInferredFrom), "::jsonb");
    if (patch.eventTypePath !== undefined) add("event_type_path", patch.eventTypePath);
    if (patch.deliveryIdHeader !== undefined) add("delivery_id_header", patch.deliveryIdHeader);
    sets.push(`updated_at = now()`);

    values.push(id);
    const { rows } = await this.pool.query(
      `UPDATE jm_webhooks SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] ? rowToWebhook(rows[0]) : null;
  }

  async rotateToken(id: string, newTenantToken: string): Promise<Webhook | null> {
    const { rows } = await this.pool.query(
      `UPDATE jm_webhooks
         SET tenant_token = $1, rotated_at = now(), updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [newTenantToken, id],
    );
    return rows[0] ? rowToWebhook(rows[0]) : null;
  }

  async touchLastEvent(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE jm_webhooks SET last_event_at = now() WHERE id = $1`,
      [id],
    );
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM jm_webhooks WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
