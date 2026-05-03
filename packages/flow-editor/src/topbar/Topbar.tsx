import { useEffect, useMemo, useState } from "react";
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
  Upload,
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
  /** When provided, an Import button appears that lets the user paste/upload a flow JSON to replace the current one. */
  onImport?: (flow: FlowGraph) => void;
}

export function Topbar(p: TopbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.flowName);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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

  const canSave = !p.busy && !!p.saveEnabled && !!p.onSave;
  const canValidate = !p.busy && !validating && !!p.onValidate;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
      if (e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        if (canSave) p.onSave!();
        return;
      }
      if (e.key.toLowerCase() === "v" && e.shiftKey && !isEditable) {
        e.preventDefault();
        if (canValidate) void runValidate();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSave, canValidate, p.onSave]);

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
            className="je-icon-btn--view-json"
            label="View JSON"
            hint="View the flow as JSON / YAML"
            icon={<FileCode2 size={16} aria-hidden="true" focusable="false" />}
            onClick={() => setExportOpen(true)}
          />
        )}
        {p.onImport && (
          <IconButton
            className="je-icon-btn--import"
            label="Import"
            hint="Replace this flow from JSON (paste or file)"
            icon={<Upload size={16} aria-hidden="true" focusable="false" />}
            onClick={() => setImportOpen(true)}
          />
        )}
        {p.onFlowConfig && (
          <IconButton
            className="je-icon-btn--flow-config"
            label="Flow Config"
            hint="Edit workflow-level defaults (provider, retry, secrets, inputs)"
            icon={<SlidersHorizontal size={16} aria-hidden="true" focusable="false" />}
            onClick={p.onFlowConfig}
          />
        )}
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
      {importOpen && p.onImport && (
        <ImportPanel
          hasExisting={!!p.flow && (p.flow.nodes.length > 2 || p.flow.edges.length > 0)}
          onImport={(flow) => { p.onImport!(flow); setImportOpen(false); }}
          onClose={() => setImportOpen(false)}
        />
      )}
      {(p.onSave || p.onValidate) && (
        <div className="je-fab" role="group" aria-label="Quick actions">
          {p.onValidate && (
            <button
              type="button"
              className="je-fab__btn je-fab__btn--validate"
              data-tooltip="Validate flow · ⌘/Ctrl+Shift+V"
              aria-label="Validate flow"
              disabled={!canValidate}
              onClick={runValidate}
            >
              {validating
                ? <Loader2 size={18} className="je-spin" aria-hidden="true" focusable="false" />
                : <ShieldCheck size={18} aria-hidden="true" focusable="false" />}
            </button>
          )}
          {p.onSave && (
            <button
              type="button"
              className="je-fab__btn je-fab__btn--primary"
              data-tooltip="Save flow · ⌘/Ctrl+S"
              aria-label="Save flow"
              disabled={!canSave}
              onClick={p.onSave}
            >
              {p.busy
                ? <Loader2 size={18} className="je-spin" aria-hidden="true" focusable="false" />
                : <Save size={18} aria-hidden="true" focusable="false" />}
            </button>
          )}
        </div>
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

function parseFlowJson(text: string): FlowGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object") throw new Error("Expected a JSON object at the root.");
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) throw new Error("Missing or invalid 'nodes' array.");
  if (!Array.isArray(obj.edges)) throw new Error("Missing or invalid 'edges' array.");
  if (typeof obj.schemaVersion !== "string" && typeof obj.schemaVersion !== "number") {
    throw new Error("Missing 'schemaVersion'.");
  }
  return obj as unknown as FlowGraph;
}

function ImportPanel({
  hasExisting,
  onImport,
  onClose,
}: {
  hasExisting: boolean;
  onImport: (flow: FlowGraph) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setFilename(file.name);
    setError(null);
    try {
      const t = await file.text();
      setText(t);
    } catch (e) {
      setError(`Could not read file: ${(e as Error).message}`);
    }
  };

  const handleImport = () => {
    setError(null);
    let flow: FlowGraph;
    try {
      flow = parseFlowJson(text);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (hasExisting) {
      const ok = window.confirm(
        "Replace the current flow? Unsaved changes and undo history will be lost.",
      );
      if (!ok) return;
    }
    onImport(flow);
  };

  return (
    <div className="je-export-panel">
      <div className="je-export-panel__header">
        <div className="je-export-panel__tabs">
          <span style={{ fontSize: 12, color: "#bbb" }}>Import flow (JSON)</span>
        </div>
        <div className="je-export-panel__spacer" />
        <label
          className="je-icon-btn"
          style={{
            background: "#2a2a3e", border: "1px solid #3a3a4e", color: "#ddd",
            padding: "6px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
          title="Choose a .json file"
        >
          <Upload size={14} aria-hidden="true" focusable="false" />
          <span>Choose file</span>
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="primary"
          onClick={handleImport}
          disabled={text.trim().length === 0}
          style={{
            background: "#00b894", border: "1px solid #00b894", color: "#fff",
            padding: "6px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600,
            cursor: text.trim().length === 0 ? "not-allowed" : "pointer",
            opacity: text.trim().length === 0 ? 0.5 : 1,
          }}
        >
          Replace flow
        </button>
        <IconButton
          className="je-export-panel__close"
          label="Close"
          onClick={onClose}
          icon={<X size={16} aria-hidden="true" focusable="false" />}
        />
      </div>
      {filename && (
        <div style={{ padding: "6px 14px", fontSize: 11, color: "#bbb", borderBottom: "1px solid #2a2a3a" }}>
          Loaded: <code>{filename}</code>
        </div>
      )}
      {error && (
        <div style={{
          padding: "8px 14px", fontSize: 12, color: "#ff7675",
          background: "#2a1a1a", borderBottom: "1px solid #ff7675",
        }}>
          {error}
        </div>
      )}
      <textarea
        className="je-export-panel__body"
        value={text}
        onChange={e => { setText(e.target.value); setError(null); }}
        placeholder='Paste flow JSON here, or use "Choose file"…'
        spellCheck={false}
        style={{
          width: "100%", minHeight: 280, resize: "vertical",
          background: "#11111a", color: "#ddd", border: 0, outline: "none",
          fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 14,
          boxSizing: "border-box",
        }}
      />
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
