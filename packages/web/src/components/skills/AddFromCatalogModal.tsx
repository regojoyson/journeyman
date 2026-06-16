import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { skillsApi, type SkillCatalogEntry, type SkillPackage } from "../../api/skills.ts";

export interface AddFromCatalogModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddFromCatalogModal(props: AddFromCatalogModalProps) {
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [chosen, setChosen] = useState<SkillCatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [shareable, setShareable] = useState<SkillPackage | null>(null);
  const [mode, setMode] = useState<"share" | "independent">("share");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    skillsApi.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  async function pick(entry: SkillCatalogEntry) {
    setChosen(entry);
    setName(entry.name);
    setError(null);
    const found =
      props.scope === "user"
        ? await skillsApi.findByUrlMy(props.orgId, entry.gitUrl)
        : await skillsApi.findByUrlOrg(props.orgId, entry.gitUrl);
    setShareable(found);
    setMode(found ? "share" : "independent");
  }

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        gitUrl: chosen.gitUrl,
        name,
        ...(shareable && mode === "share" ? { shareCloneWith: shareable.id } : {}),
      };
      if (props.scope === "user") await skillsApi.createMy(props.orgId, body);
      else await skillsApi.createOrg(props.orgId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">
            {chosen ? `Configure ${chosen.name}` : "Add from catalog"}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="text-slate-400 hover:text-slate-100 transition text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!chosen ? (
          <div className="space-y-3">
            {catalog.map((entry) => (
              <button
                key={entry.gitUrl}
                type="button"
                onClick={() => pick(entry)}
                className={`${card} p-4 w-full text-left hover:border-indigo-500 transition`}
              >
                <div className="text-sm font-medium text-slate-100">{entry.name}</div>
                <div className="mt-1 text-xs text-slate-400">{entry.description}</div>
                <div className="mt-1 flex gap-1 items-center">
                  <span className={codePill}>{entry.author}</span>
                  <span className="text-slate-500 text-xs truncate">{entry.gitUrl}</span>
                </div>
              </button>
            ))}
            {catalog.length === 0 && (
              <div className="text-sm text-slate-500 text-center py-6">Catalog is empty.</div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Name (must be unique in this scope)</label>
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {shareable && (
              <div className={`${card} p-3 space-y-2`}>
                <div className="text-xs text-slate-400">
                  This URL is already installed as <code className={codePill}>{shareable.name}</code>.
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    className="mt-1 accent-indigo-500"
                    checked={mode === "share"}
                    onChange={() => setMode("share")}
                  />
                  <div>
                    <div>Share clone with <code className={codePill}>{shareable.name}</code></div>
                    <div className="text-xs text-slate-500">No download. Pull-latest affects all instances sharing this clone.</div>
                  </div>
                </label>
                <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    className="mt-1 accent-indigo-500"
                    checked={mode === "independent"}
                    onChange={() => setMode("independent")}
                  />
                  <div>
                    <div>Independent copy</div>
                    <div className="text-xs text-slate-500">Fresh clone in its own directory. Can drift to a different commit.</div>
                  </div>
                </label>
              </div>
            )}

            {error && <div className="text-sm text-rose-400">{error}</div>}

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setChosen(null)} className={btnGhost}>← Back</button>
              <div className="flex gap-2">
                <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
                <button type="button" disabled={busy || !name.trim()} onClick={submit} className={btnPrimary}>
                  {busy ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
