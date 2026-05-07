import { useState } from "react";

export interface UnpublishWarning {
  inFlightRunCount: number;
  activeTriggers: { webhooks: number; schedules: number };
}

interface Props {
  initialWarning: UnpublishWarning | null;
  onCancel: () => void;
  /** Returns the warning if server demanded confirmation; null on success. */
  onConfirm: (confirm: boolean) => Promise<UnpublishWarning | null>;
}

export function UnpublishDialog({ initialWarning, onCancel, onConfirm }: Props): JSX.Element {
  const [warning] = useState<UnpublishWarning | null>(initialWarning);
  const [busy, setBusy] = useState(false);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    try {
      await onConfirm(true);
    } finally {
      setBusy(false);
    }
  }

  const hasActivity = warning !== null && (
    warning.inFlightRunCount > 0
    || warning.activeTriggers.webhooks > 0
    || warning.activeTriggers.schedules > 0
  );

  return (
    <div className="fe-modal-backdrop" onClick={onCancel}>
      <div className="fe-modal" onClick={e => e.stopPropagation()}>
        <h2>Move flow to Draft?</h2>
        {hasActivity
          ? (
            <>
              <p>This flow has activity:</p>
              <ul>
                {warning!.inFlightRunCount > 0
                  ? <li>{warning!.inFlightRunCount} running pipeline{warning!.inFlightRunCount === 1 ? "" : "s"}</li>
                  : null}
                {warning!.activeTriggers.webhooks > 0
                  ? <li>{warning!.activeTriggers.webhooks} active webhook{warning!.activeTriggers.webhooks === 1 ? "" : "s"}</li>
                  : null}
                {warning!.activeTriggers.schedules > 0
                  ? <li>{warning!.activeTriggers.schedules} active schedule{warning!.activeTriggers.schedules === 1 ? "" : "s"}</li>
                  : null}
              </ul>
              <p>In-flight runs continue. New triggers will be rejected until you publish again.</p>
            </>
          )
          : <p>You'll be able to edit again. Existing in-flight runs continue normally.</p>}
        <div className="fe-modal-actions">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button onClick={handleConfirm} disabled={busy}>Move to Draft</button>
        </div>
      </div>
    </div>
  );
}
