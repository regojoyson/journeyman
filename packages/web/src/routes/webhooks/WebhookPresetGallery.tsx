import { useEffect, useState } from "react";
import type { WebhookPresetSummary } from "../../api/webhooks.ts";
import { listPresets } from "../../api/webhooks.ts";

interface Props {
  onPick: (preset: WebhookPresetSummary) => void;
}

export function WebhookPresetGallery({ onPick }: Props) {
  const [presets, setPresets] = useState<WebhookPresetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ticket" | "git">("all");

  useEffect(() => {
    listPresets().then((rows) => { setPresets(rows); setLoading(false); });
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Loading presets…</p>;

  const filtered = filter === "all" ? presets : presets.filter((p) => p.kind === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-sm">
        {(["all", "ticket", "git"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded ${filter === k ? "bg-slate-700 text-slate-100" : "bg-slate-800 text-slate-400"}`}
          >
            {k === "all" ? "All" : k === "ticket" ? "Ticket systems" : "Git hosting"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className="text-left p-4 rounded border border-slate-700 hover:border-slate-500 hover:bg-slate-800/40 transition"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="font-medium text-slate-100">{p.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{p.kind}</div>
            </div>
            <div className="text-xs text-slate-400">
              {p.auth.mode} · {p.knownEventTypes.length} event types
            </div>
            {p.docsUrl && (
              <a
                href={p.docsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] text-slate-500 hover:text-slate-300 underline"
              >
                docs ↗
              </a>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
