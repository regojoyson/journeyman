import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput, Connection } from "@journeyman/core";
import { notificationFields, NOTIFICATION_PRESETS, NOTIFICATION_PLACEHOLDERS } from "@journeyman/core";
import { connectionsApi } from "../../../api/connections.ts";
import { inputCls } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function NotificationsSection({ a, patch, locked, wsId }: SectionProps) {
  const [notifyConnections, setNotifyConnections] = useState<Connection[]>([]);
  useEffect(() => {
    connectionsApi.list(wsId, "notification").then(setNotifyConnections).catch(() => setNotifyConnections([]));
  }, [wsId]);

  const selectedProvider = notifyConnections.find((c) => c.id === a.notifications.connectionId)?.provider;
  const recipient = notificationFields(selectedProvider).find((f) => f.key === "channel");

  const messageLabel = notificationFields(selectedProvider).find((f) => f.key === "message")?.label ?? "Message";
  const placeholderHint = `Placeholders: ${NOTIFICATION_PLACEHOLDERS.map((p) => p.token).join(" ")}`;

  const toggleOn = (key: "success" | "failure", checked: boolean) =>
    patch({
      notifications: {
        ...a.notifications,
        on: checked
          ? [...new Set([...a.notifications.on, key])]
          : a.notifications.on.filter((x) => x !== key),
      },
    });

  const setTpl = (outcome: "success" | "failure", field: "subject" | "body", value: string) =>
    patch({
      notifications: {
        ...a.notifications,
        templates: {
          ...a.notifications.templates,
          [outcome]: { ...a.notifications.templates?.[outcome], [field]: value || undefined },
        },
      },
    });

  const applyPreset = (id: string) => {
    const p = NOTIFICATION_PRESETS.find((x) => x.id === id);
    if (!p) return;
    patch({
      notifications: {
        ...a.notifications,
        templates: { success: { ...p.success }, failure: { ...p.failure } },
      },
    });
  };

  const outcomeEditor = (outcome: "success" | "failure", subjectDefault: string, bodyDefault: string) => (
    <div className="ml-6 mt-1 mb-2 border-l pl-3 flex flex-col gap-2" style={{ borderColor: "var(--color-border)" }}>
      <div>
        <FieldLabel help="Falls back to the default text when blank.">Subject</FieldLabel>
        <input
          className={inputCls}
          disabled={locked}
          placeholder={subjectDefault}
          value={a.notifications.templates?.[outcome]?.subject ?? ""}
          onChange={(e) => setTpl(outcome, "subject", e.target.value)}
        />
      </div>
      <div>
        <FieldLabel help="Falls back to the default text when blank.">{messageLabel}</FieldLabel>
        <textarea
          className={inputCls}
          style={{ minHeight: 72 }}
          disabled={locked}
          placeholder={bodyDefault}
          value={a.notifications.templates?.[outcome]?.body ?? ""}
          onChange={(e) => setTpl(outcome, "body", e.target.value)}
        />
      </div>
    </div>
  );

  return (
    <SectionShell title="Notifications" description="Send a message when a run finishes. Add a notification channel under Connections first, then pick when to fire — on success, failure, or both.">
      <div>
        <FieldLabel help="Channel used to send run notifications">Notification connection</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.notifications.connectionId ?? ""}
          onChange={(e) => patch({ notifications: { ...a.notifications, connectionId: e.target.value || undefined } })}
        >
          <option value="">— none —</option>
          {notifyConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.provider})
            </option>
          ))}
        </select>
        {notifyConnections.length === 0 && (
          <span className="text-xs text-muted-foreground">No notification connections yet — add one under Connections.</span>
        )}
      </div>

      <div>
        <FieldLabel help={recipient?.help ?? "Where to deliver run notifications"}>
          {recipient?.label ?? "Channel / recipient"}
        </FieldLabel>
        <input
          className={inputCls}
          disabled={locked}
          placeholder={recipient?.placeholder ?? "channel or recipient"}
          value={a.notifications.target ?? ""}
          onChange={(e) => patch({ notifications: { ...a.notifications, target: e.target.value || undefined } })}
        />
      </div>

      <div>
        <FieldLabel help="Fills the success & failure messages below with starter text. Edit freely afterwards.">Start from a template</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value=""
          onChange={(e) => { applyPreset(e.target.value); e.target.value = ""; }}
        >
          <option value="">— custom —</option>
          {NOTIFICATION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label} — {p.description}</option>
          ))}
        </select>
        <div className="text-xs text-muted-foreground mt-1">{placeholderHint}</div>
      </div>

      <div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={a.notifications.on.includes("success")}
            onChange={(e) => toggleOn("success", e.target.checked)}
          />{" "}
          Notify on success
        </label>
        {a.notifications.on.includes("success") &&
          outcomeEditor("success", 'Default: Agent "name" completed', "Default: Run <id> completed.")}
      </div>

      <div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={a.notifications.on.includes("failure")}
            onChange={(e) => toggleOn("failure", e.target.checked)}
          />{" "}
          Notify on failure
        </label>
        {a.notifications.on.includes("failure") &&
          outcomeEditor("failure", 'Default: Agent "name" failed', "Default: Run <id> failed.")}
      </div>
    </SectionShell>
  );
}
