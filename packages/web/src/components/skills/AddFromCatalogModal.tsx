import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill } from "../../routes/admin-styles.ts";
import { skillsApi, type SkillCatalogEntry } from "../../api/skills.ts";

export interface AddFromCatalogModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddFromCatalogModal(props: AddFromCatalogModalProps) {
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    skillsApi.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  async function add(entry: SkillCatalogEntry) {
    setBusy(true);
    setError(null);
    try {
      if (props.scope === "user") {
        await skillsApi.createMy(props.orgId, { gitUrl: entry.gitUrl, name: entry.name });
      } else {
        await skillsApi.createOrg(props.orgId, { gitUrl: entry.gitUrl, name: entry.name });
      }
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Add from catalog</h2>

        <div className="space-y-3">
          {catalog.map((entry) => (
            <div key={entry.gitUrl} className={`${card} p-4 flex items-start justify-between gap-4`}>
              <div>
                <div className="text-sm font-medium text-slate-100">{entry.name}</div>
                <div className="mt-1 text-xs text-slate-400">{entry.description}</div>
                <div className="mt-1 flex gap-1 items-center">
                  <span className={codePill}>{entry.author}</span>
                  <span className="text-slate-500 text-xs truncate">{entry.gitUrl}</span>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => add(entry)}
                className={btnPrimary + " shrink-0"}
              >
                Add
              </button>
            </div>
          ))}
          {catalog.length === 0 && (
            <div className="text-sm text-slate-500 text-center py-6">Catalog is empty.</div>
          )}
        </div>

        {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

        <div className="flex justify-end mt-4">
          <button type="button" onClick={props.onClose} className={btnGhost}>Close</button>
        </div>
      </div>
    </div>
  );
}
