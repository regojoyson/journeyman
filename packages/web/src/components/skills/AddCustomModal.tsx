import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { skillsApi, type SkillPackageRow } from "../../api/skills.ts";

export interface AddCustomModalProps {
  wsId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function AddCustomModal(props: AddCustomModalProps) {
  const [gitUrl, setGitUrl] = useState("");
  const [name, setName] = useState("");
  const [shareable, setShareable] = useState<SkillPackageRow | null>(null);
  const [mode, setMode] = useState<"share" | "independent">("independent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gitUrl.trim()) {
      setShareable(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const found = await skillsApi.findByUrl(props.wsId, gitUrl.trim());
        setShareable(found);
        if (found) setMode("share");
      } catch {
        setShareable(null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [gitUrl, props.wsId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        gitUrl,
        name,
        ...(shareable && mode === "share" ? { shareCloneWith: shareable.id } : {}),
      };
      await skillsApi.create(props.wsId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-md p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-4">Add custom skill package</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Git URL</label>
            <input
              className={inputCls}
              placeholder="https://github.com/org/repo or git@..."
              required
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Display name (must be unique in this workspace)</label>
            <input
              className={inputCls}
              placeholder="e.g. superpowers-tdd"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
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

          {error && <div className="text-sm text-danger">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? "Adding…" : "Add package"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
