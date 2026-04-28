// packages/phases/src/tickets/update-ticket.tsx
import { z } from "zod";
import type { PhaseDefinition, PhaseFormProps } from "@journeyman/flow-editor";
import {
  UPDATE_TICKET_PHASE_TYPE,
  UPDATE_TICKET_LABEL,
  UPDATE_TICKET_CATEGORY,
  updateTicketOutputSchema,
} from "./update-ticket.meta.ts";

interface UpdateTicketConfig {
  ticketKey: string;
  fields: Record<string, string>;
}

function UpdateTicketConfigForm({ config, onChange, readOnly }: PhaseFormProps<UpdateTicketConfig>) {
  const set = (key: string, value: string) => onChange({ ...config, fields: { ...config.fields, [key]: value } });
  const remove = (key: string) => {
    const next = { ...config.fields };
    delete next[key];
    onChange({ ...config, fields: next });
  };
  const addEmpty = () => {
    let i = 1;
    while (config.fields[`field${i}`] !== undefined) i += 1;
    onChange({ ...config, fields: { ...config.fields, [`field${i}`]: "" } });
  };

  return (
    <div>
      <div className="je-props__field">
        <label>Ticket key</label>
        <input
          type="text"
          value={config.ticketKey}
          disabled={readOnly}
          onChange={e => onChange({ ...config, ticketKey: e.target.value })}
        />
      </div>
      <div className="je-props__field">
        <label>Fields</label>
        {Object.entries(config.fields).map(([key, value]) => (
          <div key={key} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              type="text"
              value={key}
              disabled={readOnly}
              onChange={e => {
                const newKey = e.target.value;
                if (newKey === key) return;
                const next = { ...config.fields };
                delete next[key];
                next[newKey] = value;
                onChange({ ...config, fields: next });
              }}
              style={{ flex: 1 }}
            />
            <input
              type="text"
              value={value}
              disabled={readOnly}
              onChange={e => set(key, e.target.value)}
              style={{ flex: 2 }}
            />
            {!readOnly && (
              <button type="button" onClick={() => remove(key)}>×</button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={addEmpty}>+ Add field</button>
        )}
        {/* TODO: provider-specific field editor (Jira/Linear/Monday) */}
      </div>
    </div>
  );
}

export const updateTicketPhase: PhaseDefinition<UpdateTicketConfig> = {
  phaseType: UPDATE_TICKET_PHASE_TYPE,
  label: UPDATE_TICKET_LABEL,
  category: UPDATE_TICKET_CATEGORY,
  description: "Update fields on an existing ticket.",
  color: "#a29bfe",
  icon: "✏️",
  defaultConfig: { ticketKey: "", fields: {} },
  configSchema: z.object({
    ticketKey: z.string().min(1),
    fields: z.record(z.string(), z.string()),
  }),
  ConfigForm: UpdateTicketConfigForm,
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.ticketKey || "(no ticket)",
  executor: { kind: "ticket-provider", method: "updateTicket" },
  outputSchema: updateTicketOutputSchema,
};
