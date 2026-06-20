import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput, Connection } from "@journeyman/core";
import { notificationFields } from "@journeyman/core";
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

  const toggleOn = (key: "success" | "failure", checked: boolean) =>
    patch({
      notifications: {
        ...a.notifications,
        on: checked
          ? [...new Set([...a.notifications.on, key])]
          : a.notifications.on.filter((x) => x !== key),
      },
    });

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

      <label className="flex gap-2 items-center text-sm">
        <input
          type="checkbox"
          disabled={locked}
          checked={a.notifications.on.includes("success")}
          onChange={(e) => toggleOn("success", e.target.checked)}
        />{" "}
        Notify on success
      </label>
      <label className="flex gap-2 items-center text-sm">
        <input
          type="checkbox"
          disabled={locked}
          checked={a.notifications.on.includes("failure")}
          onChange={(e) => toggleOn("failure", e.target.checked)}
        />{" "}
        Notify on failure
      </label>
    </SectionShell>
  );
}
