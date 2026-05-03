import { useMemo, useState } from "react";
import type { FlowGraph, FlowSaveWarning } from "@journeyman/core";
import { validateFlowInputs } from "@journeyman/core";
import { useValidationCatalog } from "../properties-panel/use-validation-catalog.ts";
import { InputWarningsSection } from "./InputWarningsSection.tsx";
import {
  Check,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toYaml } from "./yaml-serialize.ts";
import { IconButton } from "./IconButton.tsx";

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  missing: string[];
  warnings: string[];
  secretWarnings?: FlowSaveWarning[];
  inputWarnings?: FlowSaveWarning[];
}

export interface TopbarProps {
  flowName: string;
  onRename?: (next: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  onValidate?: () => Promise<ValidationReport>;
  /** Snapshot of the flow definition; used by the export viewer. */
  flow?: FlowGraph;
  busy?: boolean;
  dirty?: boolean;
  saveEnabled?: boolean;
  runEnabled?: boolean;
  runDisabledReason?: string;
  validationErrors?: string[];
  onFlowConfig?: () => void;
}

export function Topbar(p: TopbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.flowName);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const validationCatalog = useValidationCatalog();
  const inputWarnings = useMemo(
    () => (p.flow ? validateFlowInputs(p.flow, validationCatalog) : []),
    [p.flow, validationCatalog],
  );

  const runValidate = async () => {
    if (!p.onValidate) return;
    setValidating(true);
    try {
      const r = await p.onValidate();
      setReport({ ...r, inputWarnings });
    } catch (e) {
      setReport({
        ok: false,
        errors: [`Validation request failed: ${(e as Error).message}`],
        missing: [],
        warnings: [],
        secretWarnings: [],
        inputWarnings,
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
        {p.flow && (
          <IconButton
            label="View JSON"
            hint="View the flow as JSON / YAML"
            icon={<FileCode2 size={16} aria-hidden="true" focusable="false" />}
            onClick={() => setExportOpen(true)}
          />
        )}
        {p.onFlowConfig && (
          <IconButton
            label="Flow Config"
            hint="Edit workflow-level defaults (provider, retry, secrets, inputs)"
            icon={<SlidersHorizontal size={16} aria-hidden="true" focusable="false" />}
            onClick={p.onFlowConfig}
          />
        )}
        {p.onValidate && (
          <IconButton
            label={validating ? "Validating…" : "Validate"}
            hint={validating ? "Checking the flow…" : "Check the flow without saving"}
            disabled={p.busy || validating}
            busy={validating}
            onClick={runValidate}
            icon={
              validating
                ? <Loader2 size={16} className="je-spin" aria-hidden="true" focusable="false" />
                : <ShieldCheck size={16} aria-hidden="true" focusable="false" />
            }
          />
        )}
        <IconButton
          className="primary"
          label={p.busy ? "Saving…" : "Save"}
          hint={p.busy ? "Saving the flow…" : "Save changes to this flow"}
          disabled={p.busy || !p.saveEnabled}
          busy={p.busy}
          onClick={p.onSave}
          icon={
            p.busy
              ? <Loader2 size={16} className="je-spin" aria-hidden="true" focusable="false" />
              : <Save size={16} aria-hidden="true" focusable="false" />
          }
        />
        {p.onRun && (
          <IconButton
            className="primary"
            label="Run"
            hint={p.runDisabledReason ?? "Execute this flow"}
            disabled={p.busy || !p.runEnabled}
            onClick={p.onRun}
            icon={<Play size={16} fill="currentColor" aria-hidden="true" focusable="false" />}
          />
        )}
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
      {exportOpen && p.flow && (
        <ExportPanel flow={p.flow} flowName={p.flowName} onClose={() => setExportOpen(false)} />
      )}
    </div>
  );
}

function ExportPanel({ flow, flowName, onClose }: { flow: FlowGraph; flowName: string; onClose: () => void }) {
  const [format, setFormat] = useState<"json" | "yaml">("json");
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => {
    return format === "json" ? JSON.stringify(flow, null, 2) : toYaml(flow);
  }, [flow, format]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore — older browsers without clipboard API */
    }
  };

  const handleDownload = () => {
    const slug = flowName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "flow";
    const ext = format === "json" ? "json" : "yaml";
    const mime = format === "json" ? "application/json" : "application/x-yaml";
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="je-export-panel">
      <div className="je-export-panel__header">
        <div className="je-export-panel__tabs">
          <button
            className={format === "json" ? "active" : ""}
            onClick={() => setFormat("json")}
          >JSON</button>
          <button
            className={format === "yaml" ? "active" : ""}
            onClick={() => setFormat("yaml")}
          >YAML</button>
        </div>
        <div className="je-export-panel__spacer" />
        <IconButton
          label={copied ? "Copied" : "Copy"}
          hint={copied ? "Copied to clipboard" : "Copy to clipboard"}
          onClick={handleCopy}
          icon={
            copied
              ? <Check size={16} aria-hidden="true" focusable="false" />
              : <Copy size={16} aria-hidden="true" focusable="false" />
          }
        />
        <IconButton
          label="Download"
          hint={`Download as .${format}`}
          onClick={handleDownload}
          icon={<Download size={16} aria-hidden="true" focusable="false" />}
        />
        <IconButton
          className="je-export-panel__close"
          label="Close"
          onClick={onClose}
          icon={<X size={16} aria-hidden="true" focusable="false" />}
        />
      </div>
      <pre className="je-export-panel__body"><code>{text}</code></pre>
    </div>
  );
}

function ValidationPanel({ report, onClose }: { report: ValidationReport; onClose: () => void }) {
  const secretWarnings = report.secretWarnings ?? [];
  const inputWarnings = report.inputWarnings ?? [];
  const total =
    report.errors.length + report.missing.length + report.warnings.length +
    secretWarnings.length + inputWarnings.length;
  const totalWarn = secretWarnings.length + inputWarnings.length;
  return (
    <div className="je-validate-panel">
      <div className="je-validate-panel__header">
        <span className={`je-validate-panel__status ${report.ok ? "ok" : "fail"}`}>
          {report.ok && totalWarn === 0
            ? "✓ Flow looks good"
            : report.ok
              ? `⚠ ${totalWarn} warning${totalWarn === 1 ? "" : "s"}`
              : `✕ ${total} issue${total === 1 ? "" : "s"}`}
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
        {secretWarnings.length > 0 && (
          <SecretWarningsSection warnings={secretWarnings} />
        )}
        {inputWarnings.length > 0 && (
          <InputWarningsSection warnings={inputWarnings} />
        )}
      </div>
    </div>
  );
}

function SecretWarningsSection({ warnings }: { warnings: FlowSaveWarning[] }) {
  return (
    <div className="je-validate-section je-validate-section--warn">
      <div className="je-validate-section__title">Secret warnings ({warnings.length})</div>
      {warnings.map((w, i) => {
        if (w.code === "inaccessible_secrets") {
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>{w.message}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {w.names.map(n => (
                  <code
                    key={n}
                    style={{
                      padding: "1px 6px",
                      border: "1px solid #c08a3e",
                      color: "#f0c97a",
                      borderRadius: 3,
                      fontSize: 11,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >{n}</code>
                ))}
              </div>
            </div>
          );
        }
        if (w.code === "cross_scope_pin") {
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>{w.message}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "#bbb" }}>
                {w.entries.map((e, j) => (
                  <li key={j}>
                    <code>{e.slot}</code> on node <code>{e.nodeId}</code> pinned to{" "}
                    <b>{e.pinnedScope}</b> in a <b>{e.flowScope}</b>-scope flow
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        // Other codes (input-validation variants) handled by InputWarningsSection — skip here.
        return null;
      })}
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
