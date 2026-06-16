import { useState } from "react";
import { btnGhost, btnPrimary, card, codePill } from "../../routes/admin-styles.ts";
import { skillsApi, type PromotableSkillRow } from "../../api/skills.ts";

export interface PromoteSkillDialogProps {
  orgId: string;
  row: PromotableSkillRow;
  onClose: () => void;
  onPromoted: () => void;
}

export function PromoteSkillDialog(props: PromoteSkillDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await skillsApi.promote(props.orgId, props.row.id);
      props.onPromoted();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-md p-6`}>
        <h2 className="text-lg font-semibold text-slate-100">Promote to org level</h2>
        <p className="mt-2 text-sm text-slate-400">
          Owner: <code className={codePill}>{props.row.ownerEmail}</code>. The user-level package
          will be removed and re-created as an org-scope package with the same git URL.
        </p>
        <div className="mt-3 text-sm text-slate-300">
          <span className="font-medium">{props.row.name}</span>{" "}
          <span className="text-slate-500 text-xs">{props.row.gitUrl}</span>
        </div>

        {error && <div className="mt-3 text-sm text-rose-400">{error}</div>}

        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
          <button type="button" disabled={busy} onClick={confirm} className={btnPrimary}>
            {busy ? "Promoting…" : "Promote"}
          </button>
        </div>
      </div>
    </div>
  );
}
