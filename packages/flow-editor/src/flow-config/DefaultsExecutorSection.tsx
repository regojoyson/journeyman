import { useState } from "react";
import type { FlowDefaults, CoreExecutorKind } from "@journeyman/core";
import { PROVIDER_CATALOG } from "@journeyman/core";

const KIND_LABELS: Record<CoreExecutorKind, string> = {
  "coding-cli":      "Coding CLI",
  "git-provider":    "Git Provider",
  "ticket-provider": "Ticket Provider",
  "notification":    "Notification",
};

const EXECUTOR_KINDS: CoreExecutorKind[] = ["coding-cli", "git-provider", "ticket-provider", "notification"];

const CATALOG_BY_KIND = (() => {
  const groups: Record<string, Array<{ value: string; label: string; implemented: boolean }>> = {};
  for (const p of PROVIDER_CATALOG) {
    if (!groups[p.kind]) groups[p.kind] = [];
    groups[p.kind].push({ value: p.value, label: p.label, implemented: p.implemented });
  }
  return groups;
})();

interface Props {
  defaults: FlowDefaults;
  onChange: (next: FlowDefaults) => void;
  readOnly?: boolean;
}

export function DefaultsExecutorSection({ defaults, onChange, readOnly }: Props) {
  const [open, setOpen] = useState(true);

  const setKindProvider = (kind: CoreExecutorKind, provider: string) => {
    const current = defaults.executorConfig ?? {};
    if (!provider) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [kind]: _removed, ...rest } = current;
      onChange({ ...defaults, executorConfig: Object.keys(rest).length ? rest : undefined });
    } else {
      onChange({ ...defaults, executorConfig: { ...current, [kind]: { provider } } });
    }
  };

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}
      >
        {open ? "▾" : "▸"} Default providers
      </button>
      {open && (
        <div style={{ paddingLeft: 8 }}>
          {EXECUTOR_KINDS.map(kind => {
            const entries = CATALOG_BY_KIND[kind] ?? [];
            const selected = defaults.executorConfig?.[kind]?.provider ?? "";
            return (
              <div key={kind} className="je-props__field" style={{ marginBottom: 8 }}>
                <label>{KIND_LABELS[kind]}</label>
                <select
                  value={selected}
                  disabled={readOnly}
                  onChange={e => setKindProvider(kind, e.target.value)}
                >
                  <option value="">— no default —</option>
                  {entries.map(p => (
                    <option key={p.value} value={p.value} disabled={!p.implemented}>
                      {p.label}{!p.implemented ? " (coming soon)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="je-props__field-help">
            Applied to phases that don't set their own provider. Each phase can override per-node.
          </div>
        </div>
      )}
    </div>
  );
}
