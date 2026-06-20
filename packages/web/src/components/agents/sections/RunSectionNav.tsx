export type RunSectionId = "details" | "logs" | "tokens";

const RUN_SECTIONS: Array<{ id: RunSectionId; label: string; icon: string }> = [
  { id: "details", label: "Details",       icon: "📋" },
  { id: "logs",    label: "Logs",          icon: "📜" },
  { id: "tokens",  label: "Tokens & Cost", icon: "🪙" },
];

export function RunSectionNav({
  active,
  onSelect,
}: {
  active: RunSectionId;
  onSelect: (id: RunSectionId) => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {RUN_SECTIONS.map((s) => {
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition w-full",
              isActive
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="w-4 text-center opacity-80">{s.icon}</span>
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
