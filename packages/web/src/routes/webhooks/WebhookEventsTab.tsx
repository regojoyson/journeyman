import { Fragment, useEffect, useState } from "react";
import type { WebhookEvent, WebhookEventStatus } from "@journeyman/core";
import { listWebhookEvents } from "../../api/webhooks.ts";

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<WebhookEventStatus, string> = {
  received: "bg-slate-700 text-slate-200",
  processed: "bg-emerald-900 text-emerald-200",
  ignored: "bg-slate-800 text-slate-400",
  error: "bg-red-900 text-red-200",
  auth_failed: "bg-red-900 text-red-200",
  schema_invalid: "bg-amber-900 text-amber-200",
};

function StatusBadge({ status }: { status: WebhookEventStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COLORS[status] ?? "bg-slate-700 text-slate-200"}`}>
      {status}
    </span>
  );
}

export function WebhookEventsTab({ webhookId }: { webhookId: string }) {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWebhookEvents(webhookId, { page, pageSize: PAGE_SIZE })
      .then((r) => {
        if (cancelled) return;
        setEvents(r.events);
        setTotal(r.total);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [webhookId, page, reloadKey]);

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {total === 0 ? "No events" : `Showing ${from}–${to} of ${total}`}
        </span>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 rounded px-2 py-1"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && events.length === 0 && (
        <p className="text-sm text-slate-400">No events received yet.</p>
      )}

      {!loading && !error && events.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
              <th className="py-2 font-medium">Event type</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Delivery ID</th>
              <th className="py-2 font-medium">Received</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <Fragment key={ev.id}>
                <tr
                  onClick={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                  className="border-b border-slate-800 cursor-pointer hover:bg-slate-800/50"
                >
                  <td className="py-2 text-slate-200">{ev.eventType ?? "(no type)"}</td>
                  <td className="py-2"><StatusBadge status={ev.status} /></td>
                  <td className="py-2 text-xs text-slate-500 font-mono">{ev.deliveryId ?? "—"}</td>
                  <td className="py-2 text-xs text-slate-500">{new Date(ev.receivedAt).toLocaleString()}</td>
                </tr>
                {expandedId === ev.id && (
                  <tr className="border-b border-slate-800 bg-slate-900/60">
                    <td colSpan={4} className="py-3 px-2 space-y-3">
                      {ev.error && <p className="text-xs text-red-400">error: {ev.error}</p>}
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Payload</div>
                        <pre className="text-xs text-slate-300 overflow-x-auto bg-slate-950 rounded p-2">
                          {JSON.stringify(ev.rawPayload, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Headers</div>
                        <pre className="text-xs text-slate-300 overflow-x-auto bg-slate-950 rounded p-2">
                          {JSON.stringify(ev.rawHeaders, null, 2)}
                        </pre>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            disabled={!hasPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-xs border border-slate-700 rounded px-2 py-1 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
          >
            ← Prev
          </button>
          <button
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
            className="text-xs border border-slate-700 rounded px-2 py-1 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
