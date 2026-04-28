import { useState } from "react";

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  missing: string[];
  warnings: string[];
}

export interface TopbarProps {
  flowName: string;
  onRename?: (next: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  onValidate?: () => Promise<ValidationReport>;
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
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);

  const runValidate = async () => {
    if (!p.onValidate) return;
    setValidating(true);
    try {
      const r = await p.onValidate();
      setReport(r);
    } catch (e) {
      setReport({
        ok: false,
        errors: [`Validation request failed: ${(e as Error).message}`],
        missing: [],
        warnings: [],
      });
    } finally {
      setValidating(false);
    }
  };

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
        {p.onValidate && (
          <button disabled={p.busy || validating} onClick={runValidate} title="Check the flow without saving">
            {validating ? "Validating…" : "Validate"}
          </button>
        )}
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
      {report && (
        <ValidationPanel report={report} onClose={() => setReport(null)} />
      )}
    </div>
  );
}

function ValidationPanel({ report, onClose }: { report: ValidationReport; onClose: () => void }) {
  const total = report.errors.length + report.missing.length + report.warnings.length;
  return (
    <div className="je-validate-panel">
      <div className="je-validate-panel__header">
        <span className={`je-validate-panel__status ${report.ok ? "ok" : "fail"}`}>
          {report.ok ? "✓ Flow looks good" : `✕ ${total} issue${total === 1 ? "" : "s"}`}
        </span>
        <button className="je-validate-panel__close" onClick={onClose}>×</button>
      </div>
      <div className="je-validate-panel__body">
        {report.ok && total === 0 && (
          <div className="je-validate-panel__ok">No errors, no missing inputs, no warnings.</div>
        )}
        {report.errors.length > 0 && (
          <Section title="Errors" tone="error" items={report.errors} />
        )}
        {report.missing.length > 0 && (
          <Section title="Missing required inputs" tone="error" items={report.missing} />
        )}
        {report.warnings.length > 0 && (
          <Section title="Warnings" tone="warn" items={report.warnings} />
        )}
      </div>
    </div>
  );
}

function Section({ title, tone, items }: { title: string; tone: "error" | "warn"; items: string[] }) {
  return (
    <div className={`je-validate-section je-validate-section--${tone}`}>
      <div className="je-validate-section__title">{title} ({items.length})</div>
      <ul>{items.map((m, i) => <li key={i}>{m}</li>)}</ul>
    </div>
  );
}
