import { useEffect, useMemo, useState, type ReactNode, type JSX } from "react";
import type { WorkflowGraph, WorkflowSaveWarning, WorkflowStatus } from "@journeyman/core";
import { StatusPill } from "./StatusPill.tsx";
import {
  Check,
  Copy,
  Download,
  FileCode2,
  History,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toYaml } from "./yaml-serialize.ts";
import { IconButton } from "./IconButton.tsx";
import { IssueMessage } from "../issues/IssueMessage.tsx";
import { DiagnosticCard } from "../issues/DiagnosticCard.tsx";
import type { PublishError } from "@journeyman/core";

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  missing: string[];
  warnings: string[];
  secretWarnings?: WorkflowSaveWarning[];
  diagnostics?: PublishError[];
}

export interface TopbarProps {
  flowName: string;
  onRename?: (next: string) => void;
  onSave?: () => void;
  onRun?: () => void;
  onValidate?: () => Promise<ValidationReport>;
  /** Snapshot of the flow definition; used by the export viewer. */
  flow?: WorkflowGraph;
  busy?: boolean;
  dirty?: boolean;
  saveEnabled?: boolean;
  runEnabled?: boolean;
  runDisabledReason?: string;
  validationErrors?: string[];
  /** Open the workflow-setup wizard (workflow config + inputs). */
  onWorkflowSetup?: () => void;
  /** When provided, an Import button appears that lets the user paste/upload a flow JSON to replace the current one. */
  onImport?: (flow: WorkflowGraph) => void;
  /** Lifecycle status of the flow. When omitted, the pill and transition button are hidden. */
  status?: WorkflowStatus;
  /** Called when the user clicks "Publish" (status pill area). */
  onPublishClick?: () => void;
  /** Called when the user clicks "Move to Draft" (status pill area). */
  onUnpublishClick?: () => void;
  /** Click handler for node-id links inside validation/secret-warning messages. */
  onFocusNode?: (nodeId: string) => void;
  /** When provided, a danger Delete button appears. Only shown for draft workflows by the caller. */
  onDelete?: () => void;
  /** When false the View JSON / export panel button is hidden. Defaults to true. */
  exportEnabled?: boolean;
  /** Opens the version-history panel. When omitted, the history button is hidden. */
  onHistoryClick?: () => void;
  /** Count shown as a badge on the history button. Hidden when 0/undefined. */
  versionCount?: number;
}

export function Topbar(p: TopbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.flowName);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
        secretWarnings: [],
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
            style={{ background: "rgb(var(--color-surface) / 1)", border: "1px solid rgb(var(--color-surface-raised) / 1)", color: "rgb(var(--color-text) / 1)", padding: "4px 8px", borderRadius: 4 }}
          />
        ) : (
          <h1
            onClick={() => { if (p.onRename) { setDraft(p.flowName); setEditing(true); } }}
            style={{ cursor: p.onRename ? "text" : "default" }}
          >
            {p.flowName}
          </h1>
        )}
        {p.dirty && <span style={{ color: "rgb(var(--color-warning) / 1)", fontSize: 11 }}>● unsaved</span>}
        {p.status && <StatusPill status={p.status} />}
        <div className="spacer" />
        {p.status === "draft" && p.onPublishClick && (
          <button
            type="button"
            onClick={p.onPublishClick}
            disabled={p.busy}
            style={{ padding: "4px 12px", borderRadius: 4, fontWeight: 600 }}
          >
            Publish
          </button>
        )}
        {p.status === "ready" && p.onUnpublishClick && (
          <button
            type="button"
            onClick={p.onUnpublishClick}
            disabled={p.busy}
            style={{ padding: "4px 12px", borderRadius: 4 }}
          >
            Move to Draft
          </button>
        )}
        {p.flow && p.exportEnabled !== false && (
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
        {p.onHistoryClick && (
          <IconButton
            className="je-icon-btn--history"
            label="Version history"
            hint="View and restore promoted versions"
            badge={p.versionCount}
            icon={<History size={16} aria-hidden="true" focusable="false" />}
            onClick={p.onHistoryClick}
          />
        )}
        {p.onWorkflowSetup && (
          <IconButton
            className="je-icon-btn--workflow-setup"
            label="Workflow setup"
            hint="Edit workflow config (provider, model, sandbox, retry) and inputs"
            icon={<SlidersHorizontal size={16} aria-hidden="true" focusable="false" />}
            onClick={p.onWorkflowSetup}
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
        {p.onDelete && (
          <IconButton
            className="je-icon-btn--delete"
            label="Delete"
            hint="Delete this workflow (draft only)"
            icon={<Trash2 size={16} aria-hidden="true" focusable="false" />}
            onClick={() => {
              if (window.confirm("Delete this workflow? This cannot be undone.")) {
                p.onDelete!();
              }
            }}
          />
        )}
      </header>
      {p.validationErrors && p.validationErrors.length > 0 && !report && (
        <div style={{
          background: "rgb(var(--color-danger) / 0.12)", borderBottom: "1px solid rgb(var(--color-danger) / 1)",
          color: "rgb(var(--color-danger) / 1)", fontSize: 11, padding: "6px 14px",
        }}>
          {p.validationErrors.length > 1 && (
            <>{p.validationErrors.length} validation issues — </>
          )}
          {p.flow && p.onFocusNode
            ? <IssueMessage flow={p.flow} message={p.validationErrors[0]} onSelectNode={p.onFocusNode} />
            : p.validationErrors[0]}
        </div>
      )}
      {report && (
        <ValidationPanel report={report} onClose={() => setReport(null)} flow={p.flow} onFocusNode={p.onFocusNode} />
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

function ExportPanel({ flow, flowName, onClose }: { flow: WorkflowGraph; flowName: string; onClose: () => void }) {
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

function parseFlowJson(text: string): WorkflowGraph {
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
  return obj as unknown as WorkflowGraph;
}

function ImportPanel({
  hasExisting,
  onImport,
  onClose,
}: {
  hasExisting: boolean;
  onImport: (flow: WorkflowGraph) => void;
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
    let flow: WorkflowGraph;
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
          <span style={{ fontSize: 12, color: "rgb(var(--color-text) / 1)" }}>Import flow (JSON)</span>
        </div>
        <div className="je-export-panel__spacer" />
        <label
          className="je-icon-btn"
          style={{
            background: "rgb(var(--color-surface-raised) / 1)", border: "1px solid rgb(var(--color-border) / 1)", color: "rgb(var(--color-text) / 1)",
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
            background: "rgb(var(--primary) / 1)", border: "1px solid rgb(var(--primary) / 1)", color: "rgb(var(--primary-foreground) / 1)",
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
        <div style={{ padding: "6px 14px", fontSize: 11, color: "rgb(var(--color-text) / 1)", borderBottom: "1px solid rgb(var(--color-surface-raised) / 1)" }}>
          Loaded: <code>{filename}</code>
        </div>
      )}
      {error && (
        <div style={{
          padding: "8px 14px", fontSize: 12, color: "rgb(var(--color-danger) / 1)",
          background: "rgb(var(--color-danger) / 0.12)", borderBottom: "1px solid rgb(var(--color-danger) / 1)",
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
          background: "rgb(var(--color-bg) / 1)", color: "rgb(var(--color-text) / 1)", border: 0, outline: "none",
          fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 14,
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function ValidationPanel({
  report, onClose, flow, onFocusNode,
}: {
  report: ValidationReport;
  onClose: () => void;
  flow?: WorkflowGraph;
  onFocusNode?: (id: string) => void;
}) {
  const secretWarnings = report.secretWarnings ?? [];
  const diagnostics = report.diagnostics ?? [];
  const errorDiagnostics = diagnostics.filter(d => (d.severity ?? "error") === "error");
  const warnDiagnostics = diagnostics.filter(d => d.severity === "warning");
  const total =
    report.errors.length + report.missing.length + report.warnings.length +
    secretWarnings.length + diagnostics.length;
  const totalWarn = secretWarnings.length + warnDiagnostics.length;
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
        {errorDiagnostics.length > 0 && (
          <CollapsibleSection title="Errors" tone="error" count={errorDiagnostics.length} defaultOpen>
            <div className="je-diagnostic-list">
              {errorDiagnostics.map((d, i) => (
                flow && onFocusNode
                  ? <DiagnosticCard key={`d-${i}`} flow={flow} diagnostic={d} onSelectNode={onFocusNode} />
                  : <div key={`d-${i}`}>{d.message}</div>
              ))}
            </div>
          </CollapsibleSection>
        )}
        {warnDiagnostics.length > 0 && (
          <CollapsibleSection title="Warnings" tone="warn" count={warnDiagnostics.length} defaultOpen>
            <div className="je-diagnostic-list">
              {warnDiagnostics.map((d, i) => (
                flow && onFocusNode
                  ? <DiagnosticCard key={`dw-${i}`} flow={flow} diagnostic={d} onSelectNode={onFocusNode} />
                  : <div key={`dw-${i}`}>{d.message}</div>
              ))}
            </div>
          </CollapsibleSection>
        )}
        {report.errors.length > 0 && (
          <CollapsibleSection title="Errors" tone="error" count={report.errors.length} defaultOpen>
            <SectionBody items={report.errors} flow={flow} onFocusNode={onFocusNode} />
          </CollapsibleSection>
        )}
        {report.missing.length > 0 && (
          <CollapsibleSection title="Missing required inputs" tone="error" count={report.missing.length} defaultOpen>
            <SectionBody items={report.missing} flow={flow} onFocusNode={onFocusNode} />
          </CollapsibleSection>
        )}
        {report.warnings.length > 0 && (
          <CollapsibleSection title="Warnings" tone="warn" count={report.warnings.length} defaultOpen={false}>
            <SectionBody items={report.warnings} flow={flow} onFocusNode={onFocusNode} />
          </CollapsibleSection>
        )}
        {secretWarnings.length > 0 && (
          <CollapsibleSection title="Secret warnings" tone="warn" count={secretWarnings.length} defaultOpen={false}>
            <SecretWarningsBody warnings={secretWarnings} flow={flow} onFocusNode={onFocusNode} />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title, tone, count, defaultOpen, children,
}: {
  title: string;
  tone: "error" | "warn";
  count: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`je-validate-section je-validate-section--${tone}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="je-validate-section__title"
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          background: "transparent", border: 0, padding: 0, cursor: "pointer",
          color: "inherit", font: "inherit", textAlign: "left",
        }}
        aria-expanded={open}
      >
        <span aria-hidden style={{ display: "inline-block", width: 10, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
        <span>{title} ({count})</span>
      </button>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
    </div>
  );
}

function SectionBody({
  items, flow, onFocusNode,
}: { items: string[]; flow?: WorkflowGraph; onFocusNode?: (id: string) => void }) {
  return (
    <ul>
      {items.map((m, i) => (
        <li key={i}>
          {flow && onFocusNode
            ? <IssueMessage flow={flow} message={m} onSelectNode={onFocusNode} />
            : m}
        </li>
      ))}
    </ul>
  );
}

function SecretWarningsBody({
  warnings, flow, onFocusNode,
}: { warnings: WorkflowSaveWarning[]; flow?: WorkflowGraph; onFocusNode?: (id: string) => void }) {
  const renderMessage = (m: string): JSX.Element | string =>
    flow && onFocusNode
      ? <IssueMessage flow={flow} message={m} onSelectNode={onFocusNode} />
      : m;
  const renderNodeIdChip = (nodeId: string): JSX.Element =>
    flow && onFocusNode
      ? (
        <button
          type="button"
          className="je-issue-link"
          onClick={() => onFocusNode(nodeId)}
          style={{ fontFamily: "ui-monospace, monospace" }}
        >{nodeId}</button>
      )
      : <code>{nodeId}</code>;
  return (
    <>
      {warnings.map((w, i) => {
        if (w.code === "inaccessible_secrets") {
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>{renderMessage(w.message)}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {w.names.map(n => (
                  <code
                    key={n}
                    style={{
                      padding: "1px 6px",
                      border: "1px solid rgb(var(--color-warning) / 1)",
                      color: "rgb(var(--color-warning) / 1)",
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
        if (w.code === "orphan_secret_binding") {
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>{renderMessage(w.message)}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "rgb(var(--color-text) / 1)" }}>
                {w.entries.map((e, j) => (
                  <li key={j}>
                    <code>{e.slot}</code> on node {renderNodeIdChip(e.nodeId)} — no longer declared on the step
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (w.code === "unknown_models" || w.code === "deprecated_models") {
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4 }}>{renderMessage(w.message)}</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "rgb(var(--color-text) / 1)" }}>
                {w.entries.map((e, j) => (
                  <li key={j}>
                    <code>{e.modelId}</code> ({e.provider}) — {e.location === "workflow-default"
                      ? "workflow default"
                      : <>node {e.nodeId ? renderNodeIdChip(e.nodeId) : "?"}</>}
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
