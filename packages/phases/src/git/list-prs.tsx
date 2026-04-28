// packages/phases/src/git/list-prs.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { LIST_PRS_PHASE_TYPE, LIST_PRS_LABEL, LIST_PRS_CATEGORY } from "./list-prs.meta.ts";

interface ListPrsConfig {
  owner: string;
  repo: string;
  state: "open" | "closed" | "all";
}

export const listPrsPhase: PhaseDefinition<ListPrsConfig> = {
  phaseType: LIST_PRS_PHASE_TYPE,
  label: LIST_PRS_LABEL,
  category: LIST_PRS_CATEGORY,
  description: "List pull/merge requests by state.",
  color: "#74b9ff",
  icon: "📋",
  defaultConfig: { owner: "", repo: "", state: "open" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    state: z.enum(["open", "closed", "all"]),
  }),
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository", widget: "text" },
    state: {
      label: "State", widget: "select",
      options: [
        { value: "open",   label: "Open"   },
        { value: "closed", label: "Closed" },
        { value: "all",    label: "All"    },
      ],
    },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo} [${c.state}]` : "",
  executor: { kind: "git-provider", method: "listPRs" },
};
