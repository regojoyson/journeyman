import { useState, type JSX } from "react";
import type { WorkflowGraph } from "@journeyman/core";
import type { WizardMeta } from "../wizard-state.ts";

export interface BasicDetailsStepProps {
  meta: WizardMeta;
  onChange: (next: WizardMeta) => void;
  /** Replace the draft graph from an uploaded definition (Blank keeps the seeded one). */
  onReplaceGraph: (graph: WorkflowGraph) => void;
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

export function BasicDetailsStep({ meta, onChange, onReplaceGraph }: BasicDetailsStepProps): JSX.Element {
  const [source, setSource] = useState<"blank" | "upload">("blank");
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = async (file: File): Promise<void> => {
    setUploadError(null);
    setUploadName(file.name);
    try {
      onReplaceGraph(parseFlowJson(await file.text()));
    } catch (e) {
      setUploadError((e as Error).message);
    }
  };

  return (
    <div className="je-wizard__basics">
      <label className="je-wizard__label">Name</label>
      <input
        className="je-wizard__input"
        value={meta.name}
        onChange={e => onChange({ ...meta, name: e.target.value })}
      />

      <label className="je-wizard__label">Description (optional)</label>
      <textarea
        className="je-wizard__input"
        rows={3}
        value={meta.description}
        onChange={e => onChange({ ...meta, description: e.target.value })}
      />

      <label className="je-wizard__label">Start from</label>
      <div className="je-wizard__source">
        <button
          type="button"
          className={source === "blank" ? "active" : ""}
          onClick={() => setSource("blank")}
        >Blank</button>
        <button
          type="button"
          className={source === "upload" ? "active" : ""}
          onClick={() => setSource("upload")}
        >Upload JSON</button>
      </div>
      {source === "upload" && (
        <div className="je-wizard__upload">
          <label className="je-wizard__file">
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
            />
            Choose file…
          </label>
          {uploadName && !uploadError && <span className="je-wizard__file-name">Loaded {uploadName}</span>}
          {uploadError && <span className="je-wizard__error">{uploadError}</span>}
        </div>
      )}
    </div>
  );
}
