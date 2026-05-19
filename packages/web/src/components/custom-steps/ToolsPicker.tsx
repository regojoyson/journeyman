import { CANONICAL_TOOLS, WORKSPACE_TOOLS, type CanonicalTool } from "@journeyman/core";

const TOOL_DESCRIPTIONS: Record<CanonicalTool, string> = {
  "bash":       "Run shell commands",
  "read-file":  "Read files in the workspace",
  "write-file": "Create or overwrite files",
  "edit-file":  "Patch existing files",
  "search":     "Find files by name or content (grep + glob)",
  "web-fetch":  "Fetch a URL",
  "web-search": "Search the web",
};

export function ToolsPicker(props: {
  value: CanonicalTool[];
  onChange: (next: CanonicalTool[]) => void;
  disabledTools?: ReadonlySet<CanonicalTool>;
  unsupportedTools?: ReadonlySet<CanonicalTool>;
}) {
  const selected = new Set(props.value);
  const ws = new Set<string>(WORKSPACE_TOOLS);

  const toggle = (t: CanonicalTool) => {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    props.onChange(CANONICAL_TOOLS.filter((c) => next.has(c)));
  };

  return (
    <div className="space-y-1">
      {CANONICAL_TOOLS.map((t) => {
        const isWorkspace = ws.has(t);
        const unsupported = props.unsupportedTools?.has(t);
        const disabled = props.disabledTools?.has(t);
        return (
          <label
            key={t}
            className={`flex items-center gap-2 text-xs ${unsupported ? "text-rose-300" : "text-slate-300"}`}
          >
            <input
              type="checkbox"
              className="accent-indigo-500"
              checked={selected.has(t)}
              disabled={disabled}
              onChange={() => toggle(t)}
            />
            <code className="text-slate-200">{t}</code>
            <span className="text-slate-400">— {TOOL_DESCRIPTIONS[t]}</span>
            {isWorkspace && (
              <span className="text-[10px] uppercase tracking-wide text-slate-500">workspace</span>
            )}
            {unsupported && (
              <span className="text-[10px] uppercase tracking-wide text-rose-400">
                not supported by selected provider
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
