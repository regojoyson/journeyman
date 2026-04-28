import { useState } from "react";

export interface TopbarProps {
  flowName: string;
  onRename?: (next: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  busy?: boolean;
  dirty?: boolean;
  saveEnabled?: boolean;
  runEnabled?: boolean;
  runDisabledReason?: string;
  validationErrors?: string[];
}

export function Topbar(p: TopbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.flowName);
  return (
    <div>
      <header className="je-editor__topbar">
        {editing && p.onRename ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); if (draft !== p.flowName) p.onRename!(draft); }}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ background: "#1f1f2c", border: "1px solid #2a2a3a", color: "#fff", padding: "4px 8px", borderRadius: 4 }}
          />
        ) : (
          <h1
            onClick={() => { if (p.onRename) { setDraft(p.flowName); setEditing(true); } }}
            style={{ cursor: p.onRename ? "text" : "default" }}
          >
            {p.flowName}
          </h1>
        )}
        {p.dirty && <span style={{ color: "#fdcb6e", fontSize: 11 }}>● unsaved</span>}
        <div className="spacer" />
        <button disabled={p.busy || !p.saveEnabled} onClick={p.onSave}>
          {p.busy ? "Saving…" : "Save"}
        </button>
        <button
          className="primary"
          disabled={p.busy || !p.runEnabled}
          title={p.runDisabledReason}
          onClick={p.onRun}
        >▶ Run</button>
      </header>
      {p.validationErrors && p.validationErrors.length > 0 && (
        <div style={{
          background: "#2a1a1a", borderBottom: "1px solid #ff7675",
          color: "#ff7675", fontSize: 11, padding: "6px 14px",
        }}>
          {p.validationErrors.length === 1
            ? p.validationErrors[0]
            : `${p.validationErrors.length} validation issues — ${p.validationErrors[0]}`}
        </div>
      )}
    </div>
  );
}
