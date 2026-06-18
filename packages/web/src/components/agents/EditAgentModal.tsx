import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput, CanonicalTool, Connection, RepoSummary } from "@journeyman/core";
import { agentsApi, type AgentRunSummary } from "../../api/agents.ts";
import { connectionsApi } from "../../api/connections.ts";
import { ToolsPicker } from "../custom-steps/ToolsPicker.tsx";
import { CodingModelSelect } from "../CodingModelSelect.tsx";
import { btnPrimary, btnGhost, inputCls } from "../../routes/admin-styles.ts";

type TabId = "instructions" | "workspace" | "triggers" | "behavior" | "permissions" | "notifications" | "runs";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "instructions", label: "Instructions & Inputs" },
  { id: "workspace", label: "Workspace & Model" },
  { id: "triggers", label: "Triggers" },
  { id: "behavior", label: "Behavior" },
  { id: "permissions", label: "Permissions" },
  { id: "notifications", label: "Notifications" },
  { id: "runs", label: "Run history" },
];

function AgentRuns({ orgId, agentId }: { orgId: string; agentId: string }) {
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    agentsApi
      .runs(orgId, agentId)
      .then(setRuns)
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [orgId, agentId]);
  if (loading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (runs.length === 0) return <div className="text-sm text-muted-foreground">No runs yet.</div>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1">Run</th>
          <th className="py-1">Status</th>
          <th className="py-1">Started</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="py-1">
              <a className="text-primary underline" href={`/workflow-instances/${r.id}`}>{r.id.slice(0, 8)}</a>
            </td>
            <td className="py-1">{r.status}</td>
            <td className="py-1 text-muted-foreground">{r.started_at ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EditAgentModal({ orgId, agent, onClose }: { orgId: string; agent: Agent; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("instructions");
  const [a, setA] = useState<Agent>(agent);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = a.enabled; // enabled = read-only

  // Phase 2: git connections + repo browser
  const [gitConnections, setGitConnections] = useState<Connection[]>([]);
  const [repoConnectionId, setRepoConnectionId] = useState<string>(a.repoSelections[0]?.connectionId ?? "");
  const [browsedRepos, setBrowsedRepos] = useState<RepoSummary[] | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  useEffect(() => {
    connectionsApi.listOrg(orgId, "git").then(setGitConnections).catch(() => setGitConnections([]));
  }, [orgId]);

  const patch = (p: AgentUpdateInput) => setA((prev) => ({ ...prev, ...p } as Agent));

  const addRepo = (fullName: string) => {
    setA((prev) => {
      if (prev.repoSelections.some((r) => r.repo === fullName)) return prev;
      return {
        ...prev,
        repoSelections: [...prev.repoSelections, { repo: fullName, allowWrites: false, connectionId: repoConnectionId || undefined }],
      } as Agent;
    });
  };

  const browse = async () => {
    setBrowseError(null);
    if (!repoConnectionId) {
      setBrowseError("Pick a git connection first");
      return;
    }
    try {
      const res = await connectionsApi.repos(orgId, repoConnectionId);
      if (res.error) setBrowseError(res.error);
      setBrowsedRepos(res.repos);
    } catch (e: any) {
      setBrowseError(e?.message ?? String(e));
    }
  };

  const saveSection = async (p: AgentUpdateInput) => {
    setBusy(true);
    setError(null);
    try {
      setA(await agentsApi.update(orgId, a.id, p));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      setA(a.enabled ? await agentsApi.disable(orgId, a.id) : await agentsApi.enable(orgId, a.id));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      await agentsApi.runNow(orgId, a.id, {});
      setTab("runs");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // Triggers tab: schedule + API token
  const existingSchedule = a.triggers.find((t) => t.type === "schedule") as
    | { type: "schedule"; cron: string; timezone: string }
    | undefined;
  const [scheduleOn, setScheduleOn] = useState<boolean>(Boolean(existingSchedule));
  const [cron, setCron] = useState<string>(existingSchedule?.cron ?? "0 2 * * *");
  const [timezone, setTimezone] = useState<string>(existingSchedule?.timezone ?? "UTC");
  const [apiTokens, setApiTokens] = useState<Array<{ id: string; created_at: string; last_used_at: string | null }>>([]);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  useEffect(() => {
    agentsApi.listApiTokens(orgId, a.id).then(setApiTokens).catch(() => setApiTokens([]));
  }, [orgId, a.id]);

  const saveSchedule = () => {
    const others = a.triggers.filter((t) => t.type !== "schedule");
    const next = scheduleOn ? [...others, { type: "schedule" as const, cron, timezone }] : others;
    return saveSection({ triggers: next });
  };
  const issueToken = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await agentsApi.issueApiToken(orgId, a.id);
      setRevealedToken(r.token);
      setApiTokens(await agentsApi.listApiTokens(orgId, a.id));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  const revokeToken = async (tokenId: string) => {
    await agentsApi.revokeApiToken(orgId, a.id, tokenId);
    setApiTokens(await agentsApi.listApiTokens(orgId, a.id));
  };

  // Webhook trigger (references an existing webhook by id; create it on the Webhooks page).
  const existingWebhook = a.triggers.find((t) => t.type === "webhook") as
    | { type: "webhook"; webhookId: string; preset?: string; inputsMapping?: Record<string, string> }
    | undefined;
  const [webhookOn, setWebhookOn] = useState<boolean>(Boolean(existingWebhook));
  const [webhookId, setWebhookId] = useState<string>(existingWebhook?.webhookId ?? "");
  const [mappingText, setMappingText] = useState<string>(
    Object.entries(existingWebhook?.inputsMapping ?? {})
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n"),
  );
  const saveWebhook = () => {
    const others = a.triggers.filter((t) => t.type !== "webhook");
    const inputsMapping: Record<string, string> = {};
    for (const line of mappingText.split("\n")) {
      const [name, ...rest] = line.split("=");
      if (name?.trim() && rest.length) inputsMapping[name.trim()] = rest.join("=").trim();
    }
    const triggers: Agent["triggers"] =
      webhookOn && webhookId.trim()
        ? [...others, { type: "webhook", webhookId: webhookId.trim(), inputsMapping }]
        : others;
    return saveSection({ triggers });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card text-card-foreground border rounded-lg shadow-card">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="font-semibold">
            {a.name} {a.enabled ? "· ENABLED" : `· ${a.status}`}
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} disabled={busy} onClick={runNow}>Run now</button>
            <button className={btnGhost} disabled={busy} onClick={toggleEnable}>
              {a.enabled ? "Disable to edit" : "Enable"}
            </button>
            <button className={btnGhost} onClick={onClose}>Close</button>
          </div>
        </div>

        {locked && <div className="px-4 py-2 text-sm bg-muted text-muted-foreground">🔒 Enabled — disable to edit.</div>}

        <div className="flex gap-1 border-b px-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`px-3 py-2 text-sm border-b-2 ${tab === t.id ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {error && <div className="text-sm text-destructive">{error}</div>}

          {tab === "instructions" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Instructions</label>
              <textarea
                className={`${inputCls} min-h-[120px]`}
                disabled={locked}
                value={a.instructions}
                onChange={(e) => patch({ instructions: e.target.value })}
              />
              <div className="text-xs text-muted-foreground bg-muted rounded p-2">
                Use <code>{"{{name}}"}</code> to insert an input. Available:{" "}
                {a.inputs.map((i) => `{{${i.name}}}`).join(" · ") || "—"}, <code>{"{{payload}}"}</code>,{" "}
                <code>{"{{trigger.type}}"}</code>.
              </div>
              {!locked && (
                <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ instructions: a.instructions, inputs: a.inputs })}>
                  Save section
                </button>
              )}
            </div>
          )}

          {tab === "workspace" && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Provider</label>
              <select className={inputCls} disabled={locked} value={a.provider} onChange={(e) => patch({ provider: e.target.value, model: undefined })}>
                <option value="claude">Claude</option>
                <option value="opencode">OpenCode</option>
                <option value="aisdk">AI-SDK</option>
              </select>
              <label className="text-sm font-medium">Model</label>
              <CodingModelSelect provider={a.provider} value={a.model} onChange={(m) => patch({ model: m })} disabled={locked} />

              <label className="text-sm font-medium">Git connection</label>
              <div className="flex gap-2">
                <select className={inputCls} disabled={locked} value={repoConnectionId} onChange={(e) => setRepoConnectionId(e.target.value)}>
                  <option value="">— none (paste repos below) —</option>
                  {gitConnections.map((c) => (
                    <option key={c.id} value={c.id}>{c.provider} · {c.label}</option>
                  ))}
                </select>
                {!locked && <button className={btnGhost} disabled={!repoConnectionId} onClick={browse}>Browse repos</button>}
              </div>
              {browseError && <div className="text-xs text-destructive">{browseError}</div>}
              {browsedRepos && (
                <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
                  {browsedRepos.map((r) => (
                    <button key={r.fullName} className="block text-left text-sm hover:underline" disabled={locked} onClick={() => addRepo(r.fullName)}>
                      + {r.fullName}
                    </button>
                  ))}
                </div>
              )}

              <label className="text-sm font-medium">Repositories (one owner/repo or URL per line)</label>
              <textarea
                className={inputCls}
                disabled={locked}
                value={a.repoSelections.map((r) => r.repo).join("\n")}
                onChange={(e) =>
                  patch({
                    repoSelections: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((repo) => ({ repo, allowWrites: false, connectionId: repoConnectionId || undefined })),
                  })
                }
              />
              {!locked && (
                <button
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() =>
                    saveSection({
                      provider: a.provider,
                      model: a.model,
                      repoSelections: a.repoSelections.map((r) => ({ ...r, connectionId: repoConnectionId || r.connectionId })),
                    })
                  }
                >
                  Save section
                </button>
              )}
            </div>
          )}

          {tab === "triggers" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="font-medium text-sm">⏱ Schedule</div>
                <label className="flex gap-2 items-center text-sm">
                  <input type="checkbox" disabled={locked} checked={scheduleOn} onChange={(e) => setScheduleOn(e.target.checked)} /> Run on a schedule
                </label>
                {scheduleOn && (
                  <div className="flex gap-2">
                    <input className={inputCls} disabled={locked} placeholder="cron (e.g. 0 2 * * *)" value={cron} onChange={(e) => setCron(e.target.value)} />
                    <input className={inputCls} disabled={locked} placeholder="IANA timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                  </div>
                )}
                {!locked && <button className={btnPrimary} disabled={busy} onClick={saveSchedule}>Save schedule</button>}
              </div>

              <div className="space-y-2 border-t pt-4">
                <div className="font-medium text-sm">&lt;/&gt; API</div>
                <div className="text-xs text-muted-foreground">
                  Fire via <code>POST /api/agents/{a.id}/fire</code> with <code>Authorization: Bearer &lt;token&gt;</code>.
                </div>
                {revealedToken && (
                  <div className="text-xs bg-muted rounded p-2 break-all">
                    🔑 Copy now (shown once): <code>{revealedToken}</code>
                  </div>
                )}
                <button className={btnGhost} disabled={busy} onClick={issueToken}>Issue token</button>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {apiTokens.map((t) => (
                    <li key={t.id} className="flex gap-2 items-center">
                      <span>token …{t.id.slice(0, 8)} · created {t.created_at}</span>
                      <button className="text-destructive underline" onClick={() => revokeToken(t.id)}>revoke</button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2 border-t pt-4">
                <div className="font-medium text-sm">🪝 Webhook</div>
                <div className="text-xs text-muted-foreground">
                  Create a webhook on the Webhooks page, then paste its ID here. Inbound events fire this agent.
                </div>
                <label className="flex gap-2 items-center text-sm">
                  <input type="checkbox" disabled={locked} checked={webhookOn} onChange={(e) => setWebhookOn(e.target.checked)} /> Fire from a webhook
                </label>
                {webhookOn && (
                  <>
                    <input className={inputCls} disabled={locked} placeholder="webhook id" value={webhookId} onChange={(e) => setWebhookId(e.target.value)} />
                    <label className="text-xs text-muted-foreground">Map payload → inputs (one <code>name = $.json.path</code> per line)</label>
                    <textarea className={inputCls} disabled={locked} placeholder="ticketKey = $.issue.key" value={mappingText} onChange={(e) => setMappingText(e.target.value)} />
                  </>
                )}
                {!locked && <button className={btnPrimary} disabled={busy} onClick={saveWebhook}>Save webhook</button>}
              </div>
            </div>
          )}

          {tab === "behavior" && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Max steps</label>
              <input
                type="number"
                className={inputCls}
                disabled={locked}
                value={a.behavior.maxTurns ?? ""}
                onChange={(e) => patch({ behavior: { ...a.behavior, maxTurns: e.target.value ? Number(e.target.value) : undefined } })}
              />
              <label className="text-sm font-medium">Timeout (seconds)</label>
              <input
                type="number"
                className={inputCls}
                disabled={locked}
                value={a.behavior.timeoutSeconds ?? ""}
                onChange={(e) => patch({ behavior: { ...a.behavior, timeoutSeconds: e.target.value ? Number(e.target.value) : undefined } })}
              />
              <label className="text-sm font-medium">Output mode</label>
              <select className={inputCls} disabled={locked} value={a.outputMode} onChange={(e) => patch({ outputMode: e.target.value as Agent["outputMode"] })}>
                <option value="text">Text</option>
                <option value="structured">Structured</option>
                <option value="none">None</option>
              </select>
              {!locked && (
                <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ behavior: a.behavior, outputMode: a.outputMode })}>
                  Save section
                </button>
              )}
            </div>
          )}

          {tab === "permissions" && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Allowed tools</label>
              <ToolsPicker value={a.permissions.allowedTools} onChange={(t: CanonicalTool[]) => patch({ permissions: { allowedTools: t }, tools: t })} />
              {!locked && (
                <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ permissions: a.permissions, tools: a.tools })}>
                  Save section
                </button>
              )}
            </div>
          )}

          {tab === "notifications" && (
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Notification delivery (Slack) arrives in a later phase. You can pre-select when to notify:</p>
              <label className="flex gap-2 items-center text-foreground">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={a.notifications.on.includes("success")}
                  onChange={(e) =>
                    patch({
                      notifications: {
                        on: e.target.checked
                          ? [...new Set([...a.notifications.on, "success" as const])]
                          : a.notifications.on.filter((x) => x !== "success"),
                      },
                    })
                  }
                />{" "}
                Notify on success
              </label>
              <label className="flex gap-2 items-center text-foreground">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={a.notifications.on.includes("failure")}
                  onChange={(e) =>
                    patch({
                      notifications: {
                        on: e.target.checked
                          ? [...new Set([...a.notifications.on, "failure" as const])]
                          : a.notifications.on.filter((x) => x !== "failure"),
                      },
                    })
                  }
                />{" "}
                Notify on failure
              </label>
              {!locked && (
                <button className={btnPrimary} disabled={busy} onClick={() => saveSection({ notifications: a.notifications })}>
                  Save section
                </button>
              )}
            </div>
          )}

          {tab === "runs" && <AgentRuns orgId={orgId} agentId={a.id} />}
        </div>
      </div>
    </div>
  );
}
