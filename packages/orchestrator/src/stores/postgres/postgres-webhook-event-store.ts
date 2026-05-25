import type { Pool } from "pg";
import type {
  CreateWebhookEventArgs,
  IWebhookEventStore,
  WebhookEvent,
  WebhookEventStatus,
} from "@journeyman/core";

function rowToEvent(row: any): WebhookEvent {
  return {
    id: row.id,
    receivedAt: new Date(row.received_at),
    webhookId: row.webhook_id ?? null,
    provider: row.provider,
    eventType: row.event_type,
    deliveryId: row.delivery_id,
    issueRef: row.issue_ref,
    productId: row.product_id,
    rawHeaders: row.raw_headers ?? {},
    rawPayload: row.raw_payload,
    status: row.status,
    error: row.error,
  };
}

export class PostgresWebhookEventStore implements IWebhookEventStore {
  constructor(private pool: Pool) {}

  async create(args: CreateWebhookEventArgs): Promise<WebhookEvent> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_webhook_events
         (webhook_id, provider, event_type, delivery_id, issue_ref, product_id, raw_headers, raw_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       RETURNING *`,
      [
        args.webhookId ?? null,
        args.provider,
        args.eventType ?? null,
        args.deliveryId ?? null,
        args.issueRef ?? null,
        args.productId ?? null,
        JSON.stringify(args.rawHeaders ?? {}),
        JSON.stringify(args.rawPayload),
      ],
    );
    return rowToEvent(rows[0]);
  }

  async setStatus(id: string, status: WebhookEventStatus, error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE jm_webhook_events SET status = $1, error = $2 WHERE id = $3`,
      [status, error ?? null, id],
    );
  }

  async getById(id: string): Promise<WebhookEvent | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_webhook_events WHERE id = $1",
      [id],
    );
    return rows[0] ? rowToEvent(rows[0]) : null;
  }

  async listByIssueRef(issueRef: string): Promise<WebhookEvent[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM jm_webhook_events WHERE issue_ref = $1 ORDER BY received_at DESC",
      [issueRef],
    );
    return rows.map(rowToEvent);
  }
}
