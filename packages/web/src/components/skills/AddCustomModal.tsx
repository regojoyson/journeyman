import { useState } from "react";
import { btnGhost, btnPrimary, card, inputCls } from "../../routes/admin-styles.ts";
import { skillsApi } from "../../api/skills.ts";

export interface AddCustomModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddCustomModal(props: AddCustomModalProps) {
  const [gitUrl, setGitUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (props.scope === "user") {
        await skillsApi.createMy(props.orgId, { gitUrl, name });
      } else {
        await skillsApi.createOrg(props.orgId, { gitUrl, name });
      }
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
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
            <label className="text-xs text-slate-400 mb-1 block">Display name</label>
            <input
              className={inputCls}
              placeholder="e.g. superpowers"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error && <div className="text-sm text-rose-400">{error}</div>}

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
