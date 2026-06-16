import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Webhook } from "@journeyman/core";
import { btnPrimary, card, codePill } from "./admin-styles.ts";
import { deleteWebhook, listOrgWebhooks } from "../api/webhooks.ts";
import { WebhookCreateWizard } from "./webhooks/WebhookCreateWizard.tsx";

export function AdminWebhooksPage(props: { orgId: string }) {
  const [rows, setRows] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    setRows(await listOrgWebhooks(props.orgId).catch(() => []));
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, [props.orgId]);

  async function remove(w: Webhook) {
    if (!confirm(`Delete webhook "${w.name}"?`)) return;
    await deleteWebhook(w.id);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Org Webhooks</h1>
            <p className="mt-1 text-sm text-slate-400">
              Webhook endpoints shared across this organization.
            </p>
          </div>
          {!creating && (
            <button className={btnPrimary} onClick={() => setCreating(true)}>+ New webhook</button>
          )}
        </header>

        {creating && (
          <section className={`${card} p-6`}>
            <WebhookCreateWizard
              scope={{ orgId: props.orgId }}
              onCancel={() => setCreating(false)}
              onCreated={() => { setCreating(false); void refresh(); }}
            />
          </section>
        )}

        <section className={`${card} p-0 overflow-hidden`}>
          {loading ? (
            <p className="p-6 text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">No webhooks yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-700">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Preset</th>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Last event</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-2">
                      <Link to={`/admin/webhooks/${w.id}`} className="text-success hover:underline">{w.name}</Link>
                      {w.description && <div className="text-xs text-slate-500">{w.description}</div>}
                    </td>
                    <td className="px-4 py-2"><code className={codePill}>{w.preset}</code></td>
                    <td className="px-4 py-2 text-slate-400">{w.kind}</td>
                    <td className="px-4 py-2 text-slate-400">
                      {w.lastEventAt ? new Date(w.lastEventAt).toLocaleString() : "never"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(w)}
                        className="text-xs text-danger hover:text-danger"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
