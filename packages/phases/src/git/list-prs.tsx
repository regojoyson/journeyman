// packages/phases/src/git/list-prs.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface ListPrsConfig {
  owner: string;
  repo: string;
  state: "open" | "closed" | "all";
}

export const listPrsPhase: PhaseDefinition<ListPrsConfig> = {
  phaseType: "list-prs",
  label: "List PRs",
  category: "Git",
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
