import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill } from "../../routes/admin-styles.ts";
import { skillsApi, type SkillPackage } from "../../api/skills.ts";

export interface EditSkillsModalProps {
  orgId: string;
  pkg: SkillPackage;
  onClose: () => void;
  onSaved: () => void;
}

export function EditSkillsModal(props: EditSkillsModalProps) {
  const [available, setAvailable] = useState<string[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(props.pkg.enabledSkills));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetch =
      props.pkg.scope === "user"
        ? skillsApi.discoverSkillsMy(props.orgId, props.pkg.id)
        : skillsApi.discoverSkillsOrg(props.orgId, props.pkg.id);
    fetch.then(setAvailable).catch(() => setAvailable([]));
  }, [props.pkg.id]);

  function toggle(skill: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }

  const allSelected = available.length > 0 && available.every((s) => enabled.has(s));
  const someSelected = available.some((s) => enabled.has(s)) && !allSelected;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-md max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">
          Configure skills — <span className="text-indigo-400">{props.pkg.name}</span>
        </h2>
        <p className="text-xs text-slate-400 mb-4">
          Toggle which skills from this package are enabled. All are enabled when none are selected.
        </p>

        {available.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-4">
            {props.pkg.installStatus !== "ready"
              ? "Package is not installed yet."
              : "No skills discovered in .claude-plugin/skills/."}
          </div>
        ) : (
          <div className="space-y-2">
            <label
              className={`${card} flex items-center gap-3 p-3 cursor-pointer hover:border-indigo-500 transition bg-slate-900/40`}
            >
              <input
                type="checkbox"
                className="accent-indigo-500"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={toggleAll}
              />
              <span className="text-sm font-medium text-slate-200">
                {allSelected ? "Deselect all" : "Select all"}
              </span>
              <span className="text-xs text-slate-500 ml-auto">
                {enabled.size} / {available.length}
              </span>
            </label>
            {available.map((skill) => (
              <label
                key={skill}
                className={`${card} flex items-center gap-3 p-3 cursor-pointer hover:border-indigo-500 transition`}
              >
                <input
                  type="checkbox"
                  className="accent-indigo-500"
                  checked={enabled.has(skill)}
                  onChange={() => toggle(skill)}
                />
                <span className={codePill}>{skill}</span>
              </label>
            ))}
          </div>
        )}

        {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
          <button type="button" disabled={busy} onClick={save} className={btnPrimary}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
