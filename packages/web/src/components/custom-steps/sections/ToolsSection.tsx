import { SectionShell } from "../../agents/sections/SectionShell.tsx";
import { ToolsPicker } from "../ToolsPicker.tsx";
import type { SectionProps } from "./types.ts";

export function ToolsSection({ step, patch, locked }: SectionProps) {
  return (
    <SectionShell
      title="Tools"
      description="Canonical tools and integrations this step's prompt may use by default."
    >
      <ToolsPicker
        value={step.defaultTools}
        onChange={(v) => patch({ defaultTools: v })}
        disabled={locked}
      />
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={step.requiresSkills}
            onChange={(e) => patch({ requiresSkills: e.target.checked })}
          />
          Skills required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={step.requiresMcp}
            onChange={(e) => patch({ requiresMcp: e.target.checked })}
          />
          MCP required
        </label>
      </div>
    </SectionShell>
  );
}
