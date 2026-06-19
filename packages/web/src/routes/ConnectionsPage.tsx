import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import type { Connection, ConnectionCategory } from "@journeyman/core";
import { connectionsApi, type CreateConnectionInput } from "../api/connections.ts";
import { btnPrimary, btnGhost, btnDanger, card, inputCls, selectCls } from "./admin-styles.ts";

const GIT_PROVIDERS = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
];

const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
  git: "🌿 Git",
  notification: "🔔 Notification",
};

export function ConnectionsPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

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

  const test = async (id: string) => {
    const r = await connectionsApi.test(wsId, id);
    setTestResult((m) => ({
      ...m,
      [id]: r.ok ? `✓ ${r.repoCount != null ? `${r.repoCount} repos` : (r.note ?? "ok")}` : `✗ ${r.error}`,
    }));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Connections</h1>
            <p className="mt-1 text-sm text-muted-foreground">Git accounts and notification channels agents can use.</p>
          </div>
          <button className={btnPrimary} onClick={() => setAdding(true)}>+ Connect</button>
        </header>
        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className={`${card} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Instance</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-muted-foreground" colSpan={5}>
                    {loading ? "Loading…" : "No connections yet"}
                  </td>
                </tr>
              )}
              {items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2">{CATEGORY_LABELS[c.category] ?? c.category}</td>
                  <td className="px-4 py-2">{c.provider}</td>
                  <td className="px-4 py-2 font-medium">{c.label}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.baseUrl ?? "default"}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button className={btnGhost} onClick={() => test(c.id)}>Test</button>
                    <span className="text-xs text-muted-foreground mr-2">{testResult[c.id] ?? ""}</span>
                    <button className={btnDanger} onClick={() => remove(c.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {adding && (
          <AddConnectionModal
            onCancel={() => setAdding(false)}
            onCreate={async (body) => {
              try {
                await connectionsApi.create(wsId, body);
                setAdding(false);
                await refresh();
              } catch (e: any) {
                setError(e?.message ?? String(e));
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function AddConnectionModal({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (body: CreateConnectionInput) => void;
}) {
  const [category, setCategory] = useState<ConnectionCategory>("git");
  const [provider, setProvider] = useState("github");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credential, setCredential] = useState("");

  const onSelectCategory = (next: ConnectionCategory) => {
    setCategory(next);
    setProvider(next === "git" ? "github" : "slack");
    setBaseUrl("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6" onClick={onCancel}>
      <div className={`${card} w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4`} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">New connection</h2>

        <div>
          <label className="text-sm font-medium">Type</label>
          <select className={`${selectCls} block mt-1 w-full`} value={category} onChange={(e) => onSelectCategory(e.target.value as ConnectionCategory)}>
            <option value="git">🌿 Git account</option>
            <option value="notification">🔔 Notification channel</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Provider</label>
          <select className={`${selectCls} block mt-1 w-full`} value={provider} onChange={(e) => setProvider(e.target.value)}>
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

        <div className="flex justify-end gap-2 pt-2">
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
    </div>
  );
}
