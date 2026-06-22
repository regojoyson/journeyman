export type SectionId =
  | "prompt" | "definition" | "inputs" | "output" | "tools" | "secrets" | "delete";

export const SECTIONS: Array<{ id: SectionId; label: string; icon: string; danger?: boolean }> = [
  { id: "definition", label: "Definition", icon: "📝" },
  { id: "inputs",     label: "Inputs",     icon: "↘️" },
  { id: "output",     label: "Output",     icon: "↗️" },
  { id: "tools",      label: "Tools",      icon: "🔧" },
  { id: "secrets",    label: "Secrets",    icon: "🔑" },
  { id: "prompt",     label: "Prompt",     icon: "✨" },
  { id: "delete",     label: "Delete step", icon: "🗑", danger: true },
];

export function CustomStepSectionNav({
  active,
  onSelect,
  dirtyIds = [],
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  dirtyIds?: SectionId[];
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {SECTIONS.map((s) => {
        const isActive = active === s.id;
        const separated = s.danger;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition",
              separated ? "mt-2 pt-3 border-t" : "",
              s.danger
                ? isActive
                  ? "bg-destructive/10 text-destructive font-medium"
                  : "text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                : isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="w-4 text-center opacity-80">{s.icon}</span>
            <span className="flex-1">{s.label}</span>
            {dirtyIds.includes(s.id) && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
