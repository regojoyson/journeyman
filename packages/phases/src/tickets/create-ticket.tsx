// packages/phases/src/tickets/create-ticket.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import {
  CREATE_TICKET_PHASE_TYPE,
  CREATE_TICKET_LABEL,
  CREATE_TICKET_CATEGORY,
  CREATE_TICKET_DESCRIPTION,
  createTicketOutputSchema,
} from "./create-ticket.meta.ts";

interface CreateTicketConfig {
  project: string;
  title: string;
  description: string;
  labels: string[];
}

export const createTicketPhase: PhaseDefinition<CreateTicketConfig> = {
  phaseType: CREATE_TICKET_PHASE_TYPE,
  label: CREATE_TICKET_LABEL,
  category: CREATE_TICKET_CATEGORY,
  description: CREATE_TICKET_DESCRIPTION,
  color: "#a29bfe",
  icon: "🎫",
  defaultConfig: { project: "", title: "", description: "", labels: [] },
  configSchema: z.object({
    project: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    labels: z.array(z.string()),
  }),
  configFields: {
    project:     { label: "Project key", widget: "text" },
    title:       { label: "Title", widget: "text" },
    description: { label: "Description", widget: "textarea" },
    // labels rendered as comma-separated string for round 1; the schema enforces array shape via the form's array handling below.
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  defaultRequiredSecrets: ["GITHUB_ACCESS_TOKEN"],
  summary: c => c.title || c.project,
  executor: { kind: "ticket-provider", method: "createTicket" },
  outputSchema: createTicketOutputSchema,
};
