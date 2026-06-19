import { useEffect, useState, useCallback } from "react";
import type { Connection, ConnectionCategory } from "@journeyman/core";
import { connectionsApi, type CreateConnectionInput } from "../api/connections.ts";
import { btnPrimary, btnGhost, btnDanger, card, inputCls, selectCls } from "./admin-styles.ts";

const GIT_PROVIDERS = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
];

export function ConnectionsPage({ wsId }: { wsId: string }) {
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ConnectionCategory | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await connectionsApi.list(wsId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (id: string) => {
    try {
      await connectionsApi.remove(wsId, id);
      await refresh();
    } catch (e: any) {
      const agents = (e?.body as any)?.agents as string[] | undefined;
      setError(agents ? `In use by: ${agents.join(", ")}` : (e?.message ?? String(e)));
    }
  };

  const git = items.filter((c) => c.category === "git");
  const notif = items.filter((c) => c.category === "notification");

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold">Connections</h1>
          <p className="mt-1 text-sm text-muted-foreground">Git accounts and notification channels agents can use.</p>
        </header>
        {error && <div className="text-sm text-destructive">{error}</div>}

        <Section
          title="🌿 Git accounts"
          items={git}
          onAdd={() => setAdding("git")}
          onRemove={remove}
          onTest={async (id) => connectionsApi.test(wsId, id)}
        />
        <Section
          title="🔔 Notification channels"
          items={notif}
          onAdd={() => setAdding("notification")}
          onRemove={remove}
          onTest={async (id) => connectionsApi.test(wsId, id)}
        />

        {adding && (
          <AddConnectionForm
            category={adding}
            onCancel={() => setAdding(null)}
            onCreate={async (body) => {
              try {
                await connectionsApi.create(wsId, body);
                setAdding(null);
                await refresh();
              } catch (e: any) {
                setError(e?.message ?? String(e));
              }
            }}
          />
        )}
        {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  onAdd,
  onRemove,
  onTest,
}: {
  title: string;
  items: Connection[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onTest: (id: string) => Promise<{ ok: boolean; repoCount?: number; error?: string; note?: string }>;
}) {
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="font-semibold">{title}</h2>
        <button className={btnPrimary} onClick={onAdd}>+ Connect</button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-4 py-2">Provider</th>
            <th className="px-4 py-2">Label</th>
            <th className="px-4 py-2">Instance</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td className="px-4 py-3 text-muted-foreground" colSpan={4}>None yet</td>
            </tr>
          )}
          {items.map((c) => (
            <tr key={c.id} className="border-t">
              <td className="px-4 py-2">{c.provider}</td>
              <td className="px-4 py-2 font-medium">{c.label}</td>
              <td className="px-4 py-2 text-muted-foreground">{c.baseUrl ?? "default"}</td>
              <td className="px-4 py-2 text-right">
                <button
                  className={btnGhost}
                  onClick={async () => {
                    const r = await onTest(c.id);
                    setTestResult((m) => ({
                      ...m,
                      [c.id]: r.ok ? `✓ ${r.repoCount != null ? `${r.repoCount} repos` : (r.note ?? "ok")}` : `✗ ${r.error}`,
                    }));
                  }}
                >
                  Test
                </button>
                <span className="text-xs text-muted-foreground mr-2">{testResult[c.id] ?? ""}</span>
                <button className={btnDanger} onClick={() => onRemove(c.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddConnectionForm({
  category,
  onCancel,
  onCreate,
}: {
  category: ConnectionCategory;
  onCancel: () => void;
  onCreate: (body: CreateConnectionInput) => void;
}) {
  const [provider, setProvider] = useState(category === "git" ? "github" : "slack");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credential, setCredential] = useState("");

  return (
    <div className={`${card} p-4 space-y-3`}>
      <h3 className="font-semibold">Connect {category === "git" ? "a git account" : "a notification channel"}</h3>
      <div>
        <label className="text-sm font-medium">Provider</label>
        <select className={selectCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
          {category === "git" ? (
            GIT_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)
          ) : (
            <>
              <option value="slack">Slack</option>
              <option value="console">Console</option>
            </>
          )}
        </select>
      </div>
      {category === "git" && provider === "gitlab" && (
        <div>
          <label className="text-sm font-medium">Instance URL</label>
          <input className={inputCls} placeholder="https://gitlab.acme.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
      )}
      <div>
        <label className="text-sm font-medium">Label</label>
        <input className={inputCls} placeholder="e.g. acme (work)" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div>
        <label className="text-sm font-medium">{category === "git" ? "Access token (PAT)" : "Token / webhook URL"}</label>
        <input className={inputCls} type="password" value={credential} onChange={(e) => setCredential(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <button className={btnGhost} onClick={onCancel}>Cancel</button>
        <button
          className={btnPrimary}
          disabled={!label.trim() || !credential}
          onClick={() => onCreate({ category, provider, label: label.trim(), baseUrl: baseUrl || undefined, credential })}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
