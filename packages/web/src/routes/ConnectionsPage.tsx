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
  ticket: "🎫 Ticket",
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
            <p className="mt-1 text-sm text-muted-foreground">Git accounts, notification channels, and ticket trackers agents can use.</p>
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
  const [email, setEmail] = useState("");
  const [emailMethod, setEmailMethod] = useState<"smtp" | "resend" | "sendgrid" | "mailgun" | "ses">("smtp");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailHost, setEmailHost] = useState("");
  const [emailPort, setEmailPort] = useState("587");
  const [emailSecure, setEmailSecure] = useState(false);
  const [emailUsername, setEmailUsername] = useState("");
  const [emailDomain, setEmailDomain] = useState("");
  const [emailRegion, setEmailRegion] = useState("us");
  const [emailAccessKeyId, setEmailAccessKeyId] = useState("");

  const resetEmailFields = () => {
    setEmailMethod("smtp");
    setEmailFrom("");
    setEmailHost("");
    setEmailPort("587");
    setEmailSecure(false);
    setEmailUsername("");
    setEmailDomain("");
    setEmailRegion("us");
    setEmailAccessKeyId("");
  };

  const onSelectCategory = (next: ConnectionCategory) => {
    setCategory(next);
    if (next === "git") setProvider("github");
    else if (next === "notification") setProvider("slack");
    else setProvider("jira");
    setBaseUrl("");
    setEmail("");
    resetEmailFields();
  };

  const onSelectProvider = (next: string) => {
    setProvider(next);
    resetEmailFields();
  };

  const handleCreate = () => {
    const config: Record<string, unknown> = {};
    if (category === "ticket" && provider === "jira") config.email = email;
    if (category === "notification" && provider === "email") {
      config.method = emailMethod;
      config.from = emailFrom.trim();
      if (emailMethod === "smtp") {
        config.host = emailHost.trim();
        config.port = Number(emailPort);
        config.secure = emailSecure;
        config.username = emailUsername.trim();
      }
      if (emailMethod === "mailgun") {
        config.domain = emailDomain.trim();
        config.region = emailRegion;
      }
      if (emailMethod === "ses") {
        config.region = emailRegion.trim();
        config.accessKeyId = emailAccessKeyId.trim();
      }
    }
    onCreate({
      category,
      provider,
      label: label.trim(),
      baseUrl: (category === "ticket" && provider !== "jira") ? undefined : (baseUrl || undefined),
      credential,
      config: Object.keys(config).length > 0 ? config : undefined,
    });
  };

  const credentialLabel =
    category === "git" ? "Access token (PAT)"
    : (category === "notification" && provider === "email" && emailMethod === "smtp") ? "Password"
    : (category === "notification" && provider === "email" && emailMethod === "ses") ? "Secret access key"
    : (category === "notification" && provider === "email") ? "API key"
    : "API token";

  const isDisabled =
    !label.trim() ||
    !credential ||
    (category === "ticket" && provider === "jira" && (!baseUrl.trim() || !email.trim())) ||
    (category === "notification" && provider === "email" && !emailFrom.trim()) ||
    (category === "notification" && provider === "email" && emailMethod === "smtp" && (!emailHost.trim() || !emailPort || !emailUsername.trim())) ||
    (category === "notification" && provider === "email" && emailMethod === "mailgun" && !emailDomain.trim()) ||
    (category === "notification" && provider === "email" && emailMethod === "ses" && (!emailRegion.trim() || !emailAccessKeyId.trim()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6" onClick={onCancel}>
      <div className={`${card} w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4`} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">New connection</h2>

        <div>
          <label className="text-sm font-medium">Type</label>
          <select className={`${selectCls} block mt-1 w-full`} value={category} onChange={(e) => onSelectCategory(e.target.value as ConnectionCategory)}>
            <option value="git">🌿 Git account</option>
            <option value="notification">🔔 Notification channel</option>
            <option value="ticket">🎫 Ticket tracker</option>
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Provider</label>
          <select className={`${selectCls} block mt-1 w-full`} value={provider} onChange={(e) => onSelectProvider(e.target.value)}>
            {category === "git" ? (
              GIT_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)
            ) : category === "ticket" ? (
              <>
                <option value="jira">Jira</option>
                <option value="linear">Linear</option>
                <option value="monday">Monday.com</option>
              </>
            ) : (
              <>
                <option value="slack">Slack</option>
                <option value="console">Console</option>
                <option value="email">Email</option>
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

        {category === "ticket" && provider === "jira" && (
          <>
            <div>
              <label className="text-sm font-medium">Host</label>
              <input className={inputCls} placeholder="acme.atlassian.net" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <input className={inputCls} type="email" placeholder="you@acme.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </>
        )}

        {category === "notification" && provider === "email" && (
          <>
            <div>
              <label className="text-sm font-medium">Method</label>
              <select className={`${selectCls} block mt-1 w-full`} value={emailMethod} onChange={(e) => setEmailMethod(e.target.value as typeof emailMethod)}>
                <option value="smtp">SMTP</option>
                <option value="resend">Resend</option>
                <option value="sendgrid">SendGrid</option>
                <option value="mailgun">Mailgun</option>
                <option value="ses">AWS SES</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium">From address</label>
              <input className={inputCls} type="email" placeholder="noreply@acme.com" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} />
            </div>

            {emailMethod === "smtp" && (
              <>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-sm font-medium">Host</label>
                    <input className={inputCls} placeholder="smtp.acme.com" value={emailHost} onChange={(e) => setEmailHost(e.target.value)} />
                  </div>
                  <div className="w-24">
                    <label className="text-sm font-medium">Port</label>
                    <input className={inputCls} type="number" value={emailPort} onChange={(e) => setEmailPort(e.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={emailSecure} onChange={(e) => setEmailSecure(e.target.checked)} />
                  Use TLS (secure)
                </label>
                <div>
                  <label className="text-sm font-medium">Username</label>
                  <input className={inputCls} placeholder="user@acme.com" value={emailUsername} onChange={(e) => setEmailUsername(e.target.value)} />
                </div>
              </>
            )}

            {emailMethod === "mailgun" && (
              <>
                <div>
                  <label className="text-sm font-medium">Domain</label>
                  <input className={inputCls} placeholder="mg.acme.com" value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Region</label>
                  <select className={`${selectCls} block mt-1 w-full`} value={emailRegion} onChange={(e) => setEmailRegion(e.target.value)}>
                    <option value="us">US</option>
                    <option value="eu">EU</option>
                  </select>
                </div>
              </>
            )}

            {emailMethod === "ses" && (
              <>
                <div>
                  <label className="text-sm font-medium">Region</label>
                  <input className={inputCls} placeholder="us-east-1" value={emailRegion} onChange={(e) => setEmailRegion(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Access Key ID</label>
                  <input className={inputCls} placeholder="AKIAIOSFODNN7EXAMPLE" value={emailAccessKeyId} onChange={(e) => setEmailAccessKeyId(e.target.value)} />
                </div>
              </>
            )}
          </>
        )}

        <div>
          <label className="text-sm font-medium">Label</label>
          <input className={inputCls} placeholder="e.g. acme (work)" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        <div>
          <label className="text-sm font-medium">{credentialLabel}</label>
          <input className={inputCls} type="password" value={credential} onChange={(e) => setCredential(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className={btnGhost} onClick={onCancel}>Cancel</button>
          <button
            className={btnPrimary}
            disabled={isDisabled}
            onClick={handleCreate}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
