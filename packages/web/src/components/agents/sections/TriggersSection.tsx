import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { inputCls, btnGhost, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function TriggersSection({ a, patch, locked, wsId }: SectionProps) {
  const schedule = a.triggers.find((t) => t.type === "schedule") as
    | { type: "schedule"; cron: string; timezone: string }
    | undefined;
  const webhook = a.triggers.find((t) => t.type === "webhook") as
    | { type: "webhook"; webhookId: string; inputsMapping?: Record<string, string> }
    | undefined;

  const setSchedule = (next: { cron: string; timezone: string } | null) => {
    const others = a.triggers.filter((t) => t.type !== "schedule");
    patch({ triggers: next ? [...others, { type: "schedule", ...next }] : others });
  };
  const setWebhook = (next: { webhookId: string; inputsMapping: Record<string, string> } | null) => {
    const others = a.triggers.filter((t) => t.type !== "webhook");
    patch({ triggers: next ? [...others, { type: "webhook", ...next }] : others });
  };

  const [mappingText, setMappingText] = useState<string>(
    Object.entries(webhook?.inputsMapping ?? {})
      .map(([k, v]) => `${k} = ${v}`)
      .join("\n"),
  );
  const parseMapping = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const [name, ...rest] = line.split("=");
      if (name?.trim() && rest.length) out[name.trim()] = rest.join("=").trim();
    }
    return out;
  };

  // API tokens (immediate, independent of Save)
  const [apiTokens, setApiTokens] = useState<Array<{ id: string; created_at: string }>>([]);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  useEffect(() => {
    agentsApi.listApiTokens(wsId, a.id).then(setApiTokens).catch(() => setApiTokens([]));
  }, [wsId, a.id]);
  const issueToken = async () => {
    const r = await agentsApi.issueApiToken(wsId, a.id);
    setRevealedToken(r.token);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };
  const revokeToken = async (tokenId: string) => {
    await agentsApi.revokeApiToken(wsId, a.id, tokenId);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };

  return (
    <SectionShell title="Triggers" description="How runs are started — on a schedule, via the API, or from a webhook.">
      {/* Schedule */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">⏱ Schedule</div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(schedule)}
            onChange={(e) => setSchedule(e.target.checked ? { cron: "0 2 * * *", timezone: "UTC" } : null)}
          />{" "}
          Run on a schedule
        </label>
        {schedule && (
          <div className="flex gap-2">
            <input
              className={inputCls}
              disabled={locked}
              placeholder="cron (e.g. 0 2 * * *)"
              value={schedule.cron}
              onChange={(e) => setSchedule({ cron: e.target.value, timezone: schedule.timezone })}
            />
            <input
              className={inputCls}
              disabled={locked}
              placeholder="IANA timezone"
              value={schedule.timezone}
              onChange={(e) => setSchedule({ cron: schedule.cron, timezone: e.target.value })}
            />
          </div>
        )}
      </div>

      {/* API */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">&lt;/&gt; API</div>
        <div className="text-xs text-muted-foreground">
          Fire via <code className={codePill}>POST /api/agents/{a.id}/fire</code> with{" "}
          <code className={codePill}>Authorization: Bearer &lt;token&gt;</code>.
        </div>
        {revealedToken && (
          <div className="text-xs bg-muted rounded p-2 break-all">
            🔑 Copy now (shown once): <code className={codePill}>{revealedToken}</code>
          </div>
        )}
        <button className={btnGhost} onClick={issueToken}>Issue token</button>
        <ul className="text-xs text-muted-foreground space-y-1">
          {apiTokens.map((t) => (
            <li key={t.id} className="flex gap-2 items-center">
              <span>token …{t.id.slice(0, 8)} · created {t.created_at}</span>
              <button className="text-destructive underline" onClick={() => revokeToken(t.id)}>revoke</button>
            </li>
          ))}
        </ul>
      </div>

      {/* Webhook */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">🪝 Webhook</div>
        <div className="text-xs text-muted-foreground">
          Create a webhook on the Webhooks page, then paste its ID here. Inbound events fire this agent.
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(webhook)}
            onChange={(e) =>
              setWebhook(e.target.checked ? { webhookId: "", inputsMapping: parseMapping(mappingText) } : null)
            }
          />{" "}
          Fire from a webhook
        </label>
        {webhook && (
          <>
            <input
              className={inputCls}
              disabled={locked}
              placeholder="webhook id"
              value={webhook.webhookId}
              onChange={(e) => setWebhook({ webhookId: e.target.value, inputsMapping: parseMapping(mappingText) })}
            />
            <label className="text-xs text-muted-foreground">
              Map payload → inputs (one <code className={codePill}>name = $.json.path</code> per line)
            </label>
            <textarea
              className={inputCls}
              disabled={locked}
              placeholder="ticketKey = $.issue.key"
              value={mappingText}
              onChange={(e) => {
                setMappingText(e.target.value);
                setWebhook({ webhookId: webhook.webhookId, inputsMapping: parseMapping(e.target.value) });
              }}
            />
          </>
        )}
      </div>
    </SectionShell>
  );
}
