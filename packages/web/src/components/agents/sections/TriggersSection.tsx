import type { Agent, AgentTrigger, AgentUpdateInput } from "@journeyman/core";
import { SectionShell } from "./SectionShell.tsx";
import { ScheduleTrigger } from "./ScheduleTrigger.tsx";
import { ApiTrigger } from "./ApiTrigger.tsx";
import { WebhookTrigger } from "./WebhookTrigger.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

function TriggerCard({
  title,
  enabled,
  locked,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  locked: boolean;
  onToggle: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div
        className={`flex items-center justify-between px-4 py-3 ${
          enabled ? "bg-muted/60" : "bg-muted/20"
        }`}
      >
        <span className="font-medium text-sm">{title}</span>
        <button
          type="button"
          disabled={locked}
          onClick={() => onToggle(!enabled)}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            enabled ? "bg-primary" : "bg-input"
          } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
          role="switch"
          aria-checked={enabled}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ${enabled ? "translate-x-4" : "translate-x-0"}`} />{/* theme-colors-allow: knob stays white for contrast on the track */}
        </button>
      </div>
      {enabled && <div className="p-4">{children}</div>}
    </div>
  );
}

export function TriggersSection({ a, patch, locked, wsId }: SectionProps) {
  const scheduleTrigger = a.triggers.find((t): t is Extract<AgentTrigger, { type: "schedule" }> => t.type === "schedule");
  const apiTrigger = a.triggers.find((t): t is Extract<AgentTrigger, { type: "api" }> => t.type === "api");
  const webhookTrigger = a.triggers.find((t): t is Extract<AgentTrigger, { type: "webhook" }> => t.type === "webhook");

  const replaceOrRemove = (type: AgentTrigger["type"], next: AgentTrigger | null) => {
    const others = a.triggers.filter((t) => t.type !== type);
    patch({ triggers: next ? [...others, next] : others });
  };

  const toggleSchedule = (on: boolean) =>
    replaceOrRemove("schedule", on ? { type: "schedule", cron: "0 9 * * 1", timezone: "UTC" } : null);

  const toggleApi = (on: boolean) =>
    replaceOrRemove("api", on ? { type: "api" } : null);

  const toggleWebhook = (on: boolean) =>
    replaceOrRemove(
      "webhook",
      on ? { type: "webhook", webhookId: "", listensFor: [], filters: undefined, inputsMapping: {} } : null,
    );

  return (
    <SectionShell
      title="Triggers"
      description="Define what starts a run. Triggers can be combined — schedule + API at the same time. Webhook triggers fire when an external system sends a matching event."
    >
      <div className="space-y-3">
        {/* Schedule */}
        <TriggerCard
          title="⏱  Schedule"
          enabled={Boolean(scheduleTrigger)}
          locked={locked}
          onToggle={toggleSchedule}
        >
          <ScheduleTrigger
            cron={scheduleTrigger?.cron ?? "0 9 * * 1"}
            timezone={scheduleTrigger?.timezone ?? "UTC"}
            fixedInputs={(scheduleTrigger?.fixedInputs as Record<string, string>) ?? {}}
            inputs={a.inputs}
            locked={locked}
            onChange={(cron, timezone, fixedInputs) =>
              replaceOrRemove("schedule", { type: "schedule", cron, timezone, fixedInputs })
            }
          />
        </TriggerCard>

        {/* API */}
        <TriggerCard
          title="</> API"
          enabled={Boolean(apiTrigger)}
          locked={locked}
          onToggle={toggleApi}
        >
          <ApiTrigger agentId={a.id} wsId={wsId} inputs={a.inputs} />
        </TriggerCard>

        {/* Webhook */}
        <TriggerCard
          title="🪝 Webhook"
          enabled={Boolean(webhookTrigger)}
          locked={locked}
          onToggle={toggleWebhook}
        >
          <WebhookTrigger
            wsId={wsId}
            webhookId={webhookTrigger?.webhookId ?? ""}
            listensFor={webhookTrigger?.listensFor ?? []}
            filters={webhookTrigger?.filters}
            inputsMapping={(webhookTrigger?.inputsMapping ?? {}) as Record<string, string>}
            inputs={a.inputs}
            locked={locked}
            onChange={({ webhookId, listensFor, filters, inputsMapping }) =>
              replaceOrRemove("webhook", {
                type: "webhook",
                webhookId,
                listensFor,
                filters,
                inputsMapping,
              })
            }
          />
        </TriggerCard>
      </div>
    </SectionShell>
  );
}
