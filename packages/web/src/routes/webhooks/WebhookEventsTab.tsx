import { useEffect, useState } from "react";
import type { WebhookEvent } from "@journeyman/core";
import { listRecentEventsForWebhook } from "../../api/webhooks.ts";

export function WebhookEventsTab({ webhookId }: { webhookId: string }) {
  const [rows, setRows] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listRecentEventsForWebhook(webhookId).then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, [webhookId]);

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No recent events shown. Per-webhook event listing requires a dedicated API endpoint
        that isn't part of plan 2's surface; this tab is a placeholder until that ships.
      </p>
    );
  }

  return (
    <ul className="space-y-2 text-sm">
      {rows.map((ev) => (
        <li key={ev.id} className="rounded border border-slate-700 px-3 py-2">
          <div className="flex justify-between">
            <span className="text-slate-200">{ev.eventType ?? "(no type)"}</span>
            <span className="text-xs text-slate-500">{new Date(ev.receivedAt).toLocaleString()}</span>
          </div>
          <div className="text-xs text-slate-500">status: {ev.status}</div>
        </li>
      ))}
    </ul>
  );
}
