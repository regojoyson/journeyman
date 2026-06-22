import { useEffect, useState } from "react";

interface VisibleMcp {
  id: string;
  name: string;
  description: string | null;
  scope: "user" | "org";
  enabled: boolean;
}

interface VisibleSkill {
  id: string;
  name: string;
  scope: "user" | "org";
  installStatus: "pending" | "installing" | "ready" | "error";
  enabledSkillCount: number;
}

function byScopeThenName<T extends { scope: "user" | "org"; name: string }>(a: T, b: T): number {
  return a.scope === b.scope
    ? a.name.localeCompare(b.name)
    : a.scope === "org" ? -1 : 1;
}

const rowBase =
  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition";
const rowOn = "border-primary bg-primary/5";
const rowOff = "border-border hover:bg-accent/50";

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function VisibleMcpPicker({
  wsId,
  value,
  onChange,
  disabled,
}: {
  wsId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [available, setAvailable] = useState<VisibleMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = new Set(value);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/workspaces/${wsId}/mcp-instances/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleMcp[]) => {
        if (!alive) return;
        setAvailable([...rows].filter((m) => m.enabled).sort(byScopeThenName));
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wsId]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading…</div>;
  if (available.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No MCP connectors available. Add some on the{" "}
        <a className="text-primary underline" href={`/workspaces/${wsId}/mcps`} target="_blank" rel="noreferrer">MCPs page</a>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {available.map((m) => {
        const checked = selected.has(m.id);
        return (
          <label
            key={m.id}
            className={`${rowBase} ${checked ? rowOn : rowOff} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            title={m.description ?? ""}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(toggleId(value, m.id))}
            />
            <span className="flex-1">{m.name}</span>
            <span className="text-[10px] text-muted-foreground">{m.scope}</span>
          </label>
        );
      })}
    </div>
  );
}

export function VisibleSkillPicker({
  wsId,
  value,
  onChange,
  disabled,
}: {
  wsId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [available, setAvailable] = useState<VisibleSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = new Set(value);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/workspaces/${wsId}/skill-packages/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleSkill[]) => {
        if (!alive) return;
        setAvailable([...rows].sort(byScopeThenName));
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wsId]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading…</div>;
  if (available.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No skill packages available. Add some on the{" "}
        <a className="text-primary underline" href={`/workspaces/${wsId}/skills`} target="_blank" rel="noreferrer">Skills page</a>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {available.map((s) => {
        const checked = selected.has(s.id);
        return (
          <label
            key={s.id}
            className={`${rowBase} ${checked ? rowOn : rowOff} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            title={`${s.enabledSkillCount} enabled skill${s.enabledSkillCount === 1 ? "" : "s"}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(toggleId(value, s.id))}
            />
            <span className="flex-1">{s.name}</span>
            <span className="text-[10px] text-muted-foreground">{s.enabledSkillCount} skills</span>
            <span className="text-[10px] text-muted-foreground">{s.scope}</span>
          </label>
        );
      })}
    </div>
  );
}
