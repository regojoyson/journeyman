import { useState } from "react";
import type { Agent } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { inputCls, btnDanger } from "../../../routes/admin-styles.ts";
import { SectionShell } from "./SectionShell.tsx";

export function DeleteSection({
  a,
  wsId,
  locked,
  onDeleted,
}: {
  a: Agent;
  wsId: string;
  locked: boolean;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmText.trim() === a.name;

  const del = async () => {
    if (!matches || locked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await agentsApi.remove(wsId, a.id);
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="Delete agent"
      description="Permanently delete this agent and its run history. This cannot be undone."
    >
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
        {locked ? (
          <p className="text-sm text-muted-foreground">Disable the agent before deleting it.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{a.name}</span> to confirm.
            </p>
            <input
              className={inputCls}
              placeholder={a.name}
              value={confirmText}
              disabled={busy}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {error && <div className="text-sm text-destructive">{error}</div>}
            <button className={btnDanger} disabled={!matches || busy} onClick={del}>
              {busy ? "Deleting…" : "Delete agent"}
            </button>
          </>
        )}
      </div>
    </SectionShell>
  );
}
