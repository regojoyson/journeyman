// packages/phases/src/git/create-pr.tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";

interface CreatePrConfig {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
}

export const createPrPhase: PhaseDefinition<CreatePrConfig> = {
  phaseType: "create-pr",
  label: "Create PR",
  category: "Git",
  description: "Open a pull/merge request on the remote.",
  color: "#74b9ff",
  icon: "🔀",
  defaultConfig: { owner: "", repo: "", title: "", body: "", head: "", base: "main" },
  configSchema: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    head: z.string().min(1),
    base: z.string().min(1),
  }),
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository", widget: "text" },
    title: { label: "Title", widget: "text" },
    body:  { label: "Body",  widget: "textarea" },
    head:  { label: "Head branch", widget: "text" },
    base:  { label: "Base branch", widget: "text" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "hidden", retry: "shown" },
  summary: c => c.head && c.base ? `${c.base} ← ${c.head}` : (c.title || ""),
  executor: { kind: "git-provider", method: "createPR" },
};
