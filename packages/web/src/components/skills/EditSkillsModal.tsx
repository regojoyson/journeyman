import { useEffect, useMemo, useState } from "react";
import { btnGhost, btnPrimary } from "../../routes/admin-styles.ts";
import { skillsApi, type SkillPackage } from "../../api/skills.ts";

export interface EditSkillsModalProps {
  orgId: string;
  pkg: SkillPackage;
  onClose: () => void;
  onSaved: () => void;
}

export function EditSkillsModal(props: EditSkillsModalProps) {
  const [available, setAvailable] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(props.pkg.enabledSkills));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    const fetch =
      props.pkg.scope === "user"
        ? skillsApi.discoverSkillsMy(props.orgId, props.pkg.id)
        : skillsApi.discoverSkillsOrg(props.orgId, props.pkg.id);
    fetch
      .then((rows) => setAvailable(rows.slice().sort((a, b) => a.localeCompare(b))))
      .catch(() => setAvailable([]))
      .finally(() => setLoading(false));
  }, [props.pkg.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  function toggle(skill: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((s) => s.toLowerCase().includes(q));
  }, [available, query]);

  const allSelected = available.length > 0 && available.every((s) => enabled.has(s));
  const someSelected = enabled.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) setEnabled(new Set());
    else setEnabled(new Set(available));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (props.pkg.scope === "user") {
        await skillsApi.updateEnabledSkillsMy(props.orgId, props.pkg.id, [...enabled]);
      } else {
        await skillsApi.updateEnabledSkillsOrg(props.orgId, props.pkg.id, [...enabled]);
      }
      props.onSaved();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-sm p-4 animate-in fade-in"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-800">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500 mb-1">
              <span>Configure skills</span>
              <span className="text-slate-700">·</span>
              <span className={props.pkg.scope === "org" ? "text-amber-400" : "text-sky-400"}>
                {props.pkg.scope}
              </span>
            </div>
            <h2 className="text-lg font-semibold text-slate-100 truncate">{props.pkg.name}</h2>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            className="shrink-0 -mt-1 -mr-2 h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        {available.length > 0 && (
          <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-3">
            <div className="relative flex-1">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter skills…"
                className="w-full rounded-md bg-slate-800/60 border border-slate-700 pl-8 pr-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition"
              />
            </div>
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 whitespace-nowrap transition"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
              {enabled.size} / {available.length}
            </span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Toggle which skills from this package are enabled. If none are selected, all skills
            are enabled by default.
          </p>

          {loading ? (
            <div className="py-10 text-center text-sm text-slate-500">Loading skills…</div>
          ) : available.length === 0 ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 h-10 w-10 grid place-items-center rounded-full bg-slate-800/60 text-slate-500">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
              </div>
              <div className="text-sm text-slate-400">
                {props.pkg.installStatus !== "ready"
                  ? "Package is not installed yet."
                  : "No skills discovered in .claude-plugin/skills/."}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              No skills match <span className="text-slate-300">"{query}"</span>.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {filtered.map((skill) => {
                const checked = enabled.has(skill);
                return (
                  <li key={skill}>
                    <label
                      className={
                        "group flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition " +
                        (checked
                          ? "bg-indigo-500/10 border-indigo-500/40 hover:border-indigo-400"
                          : "bg-slate-800/30 border-slate-800 hover:border-slate-700 hover:bg-slate-800/60")
                      }
                    >
                      <input
                        type="checkbox"
                        className="accent-indigo-500 h-4 w-4"
                        checked={checked}
                        onChange={() => toggle(skill)}
                      />
                      <span
                        className={
                          "font-mono text-xs truncate " +
                          (checked ? "text-indigo-200" : "text-slate-300")
                        }
                      >
                        {skill}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between gap-3">
          <div className="min-w-0 text-xs">
            {error ? (
              <span className="text-rose-400 truncate block">{error}</span>
            ) : (
              <span className="text-slate-500">
                {someSelected || allSelected
                  ? `${enabled.size} skill${enabled.size === 1 ? "" : "s"} enabled`
                  : "All skills enabled (default)"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={props.onClose} className={btnGhost}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={save} className={btnPrimary}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
