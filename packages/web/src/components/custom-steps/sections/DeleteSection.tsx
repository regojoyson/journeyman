import { useState } from "react";
import type { CustomAiStep } from "@journeyman/core";
import { customStepsApi } from "../../../api/customSteps.ts";
import { inputCls, btnDanger } from "../../../routes/admin-styles.ts";
import { SectionShell } from "../../agents/sections/SectionShell.tsx";

export function DeleteSection({
  step,
  wsId,
  locked,
  onDeleted,
}: {
  step: CustomAiStep;
  wsId: string;
  locked: boolean;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmText.trim() === step.name;

  const del = async () => {
    if (!matches || locked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await customStepsApi.remove(wsId, step.id);
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="Delete step"
      description="Permanently delete this custom step. This cannot be undone."
    >
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
        {locked ? (
          <p className="text-sm text-muted-foreground">Disable the step before deleting it.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{step.name}</span> to confirm.
            </p>
            <input
              className={inputCls}
              placeholder={step.name}
              value={confirmText}
              disabled={busy}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {error && <div className="text-sm text-destructive">{error}</div>}
            <button className={btnDanger} disabled={!matches || busy} onClick={del}>
              {busy ? "Deleting…" : "Delete step"}
            </button>
          </>
        )}
      </div>
    </SectionShell>
  );
}
