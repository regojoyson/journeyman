import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Webhook } from "@journeyman/core";
import { card } from "./admin-styles.ts";
import { deleteWebhook, getWebhook, updateWebhook } from "../api/webhooks.ts";
import { InlineEdit } from "./webhooks/InlineEdit.tsx";
import { WebhookOverviewTab } from "./webhooks/WebhookOverviewTab.tsx";
import { WebhookSchemaTab } from "./webhooks/WebhookSchemaTab.tsx";
import { WebhookEventsTab } from "./webhooks/WebhookEventsTab.tsx";
import { WebhookTestPanel } from "./webhooks/WebhookTestPanel.tsx";

type Tab = "overview" | "schema" | "events" | "test";

export function WebhookDetailPage(props: { backTo: string }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getWebhook(id).then(setWebhook).catch((e) => setError(e.message));
  }, [id]);

  async function remove() {
    if (!webhook) return;
    if (!confirm(`Delete webhook "${webhook.name}"?`)) return;
    await deleteWebhook(webhook.id);
    navigate(props.backTo);
  }

  async function saveName(next: string | null) {
    if (!webhook || next === null) return;
    const updated = await updateWebhook(webhook.id, { name: next });
    setWebhook(updated);
  }

  async function saveDescription(next: string | null) {
    if (!webhook) return;
    const updated = await updateWebhook(webhook.id, { description: next });
    setWebhook(updated);
  }

  if (error) return <p className="p-6 text-sm text-danger">{error}</p>;
  if (!webhook) return <p className="p-6 text-sm text-slate-400">Loading…</p>;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "schema",   label: "Schema" },
    { id: "events",   label: "Recent events" },
    { id: "test",     label: "Send test event" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-6">
        <header className="flex items-start justify-between">
          <div>
            <Link to={props.backTo} className="text-xs text-slate-500 hover:text-slate-300">← back</Link>
            <div className="mt-1">
              <InlineEdit
                value={webhook.name}
                onSave={saveName}
                ariaLabel="webhook name"
                displayClassName="text-2xl font-semibold text-slate-100"
              />
            </div>
            <div className="mt-1">
              <InlineEdit
                value={webhook.description ?? ""}
                multiline
                allowEmpty
                onSave={saveDescription}
                placeholder="Add description"
                ariaLabel="webhook description"
                displayClassName="text-sm text-slate-400"
              />
            </div>
          </div>
          <button onClick={remove} className="text-xs text-danger hover:text-danger">Delete</button>
        </header>

        <nav className="flex gap-2 border-b border-slate-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 ${
                tab === t.id ? "border-emerald-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section className={`${card} p-6`}>
          {tab === "overview" && <WebhookOverviewTab webhook={webhook} onChange={setWebhook} />}
          {tab === "schema"   && <WebhookSchemaTab   webhook={webhook} onChange={setWebhook} />}
          {tab === "events"   && <WebhookEventsTab   webhookId={webhook.id} />}
          {tab === "test"     && <WebhookTestPanel   webhook={webhook} />}
        </section>
      </div>
    </div>
  );
}
