// packages/flow-editor/src/properties-panel/ConnectionPicker.tsx
import { useEffect, useState } from "react";
import type { Connection, ConnectionCategory } from "@journeyman/core";
import { fetchConnections } from "../api/connections.ts";
import { useWsId } from "../state/org-context.tsx";

interface Props {
  category: ConnectionCategory;
  value: string | null | undefined;
  onChange: (connectionId: string | null) => void;
  readOnly?: boolean;
  onResolved?: (connection: Connection | null) => void;
}

const CATEGORY_LABEL: Record<ConnectionCategory, string> = {
  git: "Git",
  ticket: "Ticket tracker",
  notification: "Notification",
};

export function ConnectionPicker({ category, value, onChange, readOnly, onResolved }: Props) {
  const wsId = useWsId();
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    if (!wsId) return;
    fetchConnections(wsId, category).then(setConnections).catch(() => {});
  }, [wsId, category]);

  useEffect(() => {
    if (!onResolved) return;
    onResolved(connections.find(c => c.id === value) ?? null);
  }, [value, connections, onResolved]);

  return (
    <div className="je-props__field">
      <label>{CATEGORY_LABEL[category]} connection</label>
      <select
        value={value ?? ""}
        disabled={readOnly}
        onChange={e => onChange(e.target.value || null)}
      >
        <option value="">— pick a connection —</option>
        {connections.map(c => (
          <option key={c.id} value={c.id}>
            {c.label} ({c.provider})
          </option>
        ))}
      </select>
      {connections.length === 0 && (
        <div className="je-props__field-help">
          No {CATEGORY_LABEL[category].toLowerCase()} connections in this workspace.{" "}
          <a href="/connections" target="_blank" rel="noopener noreferrer">Set one up →</a>
        </div>
      )}
    </div>
  );
}
