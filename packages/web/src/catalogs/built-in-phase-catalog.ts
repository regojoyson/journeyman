import type { PhaseCatalog } from "@journeyman/flow-editor";

export const builtInPhaseCatalog: PhaseCatalog = [
  {
    phaseType: "analyze",
    label: "Analyze",
    category: "AI",
    description: "Analyze a repo against a ticket using Claude.",
    color: "#00b894",
    icon: "🤖",
  },
];
