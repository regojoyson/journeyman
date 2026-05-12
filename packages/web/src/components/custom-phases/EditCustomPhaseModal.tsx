import { useState } from "react";
import type {
  CustomAiPhase, CustomAiPhaseCreateInput, CustomPhaseInputField,
  CustomPhaseOutputMode, CustomPhaseJsonSchema,
  CanonicalTool,
} from "@journeyman/core";
import { toolsRequireWorkspace } from "@journeyman/core";
import { InputFieldsEditor } from "./InputFieldsEditor.tsx";
import { OutputSchemaEditor } from "./OutputSchemaEditor.tsx";
import { ToolsPicker } from "./ToolsPicker.tsx";
import { btnGhost, btnPrimary, card, inputCls } from "../../routes/admin-styles.ts";

export function EditCustomPhaseModal(props: {
  initial?: CustomAiPhase;
  scope: "user" | "org";
  onCancel: () => void;
  onSave: (body: CustomAiPhaseCreateInput) => Promise<void>;
}) {
  const { initial, scope, onCancel, onSave } = props;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [inputFields, setInputFields] = useState<CustomPhaseInputField[]>(initial?.inputFields ?? []);
  const [outputMode, setOutputMode] = useState<CustomPhaseOutputMode>(initial?.outputMode ?? "none");
  const [outputSchema, setOutputSchema] = useState<CustomPhaseJsonSchema | undefined>(initial?.outputSchema);
  const [promptTemplate, setPromptTemplate] = useState(initial?.promptTemplate ?? "");
  const [defaultTools, setDefaultTools] = useState<CanonicalTool[]>(initial?.defaultTools ?? []);
  const [pendingTools, setPendingTools] = useState<CanonicalTool[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToolsChange = (next: CanonicalTool[]) => {
    const becomingWorkspace = !toolsRequireWorkspace(defaultTools) && toolsRequireWorkspace(next);
    const hasWorkspaceField = inputFields.some((f) => f.name === "workspaceDir");
    if (becomingWorkspace && !hasWorkspaceField) {
      setPendingTools(next);
      return;
    }
    setDefaultTools(next);
  };

  const confirmAddWorkspaceInput = () => {
    if (!pendingTools) return;
    setInputFields((prev) => [
      ...prev,
      {
        name: "workspaceDir",
        type: "workspaceDir",
        required: true,
        description: "Working directory for shell/file tools",
      },
    ]);
    setDefaultTools(pendingTools);
    setPendingTools(null);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        scope,
        name, description,
        inputFields,
        outputMode,
        outputSchema: outputMode === "structured" ? outputSchema : undefined,
        promptTemplate,
        defaultTools,
        defaultMcpIds: initial?.defaultMcpIds ?? [],
        defaultSkillIds: initial?.defaultSkillIds ?? [],
      });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-6`}>
        <div>
          <h2 className="text-lg font-semibold text-slate-100">
            {initial ? "Edit" : "New"} custom phase
            <span className="text-slate-500 text-sm font-normal ml-2">({scope})</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Define a reusable AI phase with typed inputs and an optional structured output.
          </p>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Definition</h3>
          <div className="space-y-2">
            <label className="block text-xs text-slate-400">
              Name
              <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block text-xs text-slate-400">
              Description
              <textarea
                className={`${inputCls} mt-1`}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Inputs</h3>
          <InputFieldsEditor value={inputFields} onChange={setInputFields} />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Output</h3>
          <OutputSchemaEditor
            mode={outputMode}
            schema={outputSchema}
            onModeChange={setOutputMode}
            onSchemaChange={setOutputSchema}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Tools</h3>
          <ToolsPicker value={defaultTools} onChange={handleToolsChange} />
          {toolsRequireWorkspace(defaultTools) && (
            <p className="text-[11px] text-slate-400">
              A workspace tool is selected — flows using this phase must wire a{" "}
              <code>workspaceDir</code> input.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium text-slate-200">Prompt</h3>
          <textarea
            className={`${inputCls} font-mono text-xs`}
            rows={10}
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder="Use {{inputName}} to substitute input values"
          />
        </section>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <footer className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button type="button" className={btnGhost} onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
      {pendingTools !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
          <div className={`${card} w-full max-w-md p-6 space-y-4`}>
            <h3 className="text-base font-semibold text-slate-100">Add required workspaceDir input?</h3>
            <p className="text-sm text-slate-300">
              These tools need a workspace (bash, read-file, write-file, edit-file, search).
              Add a required <code>workspaceDir</code> input to this phase? Flows using this phase
              will then need to wire it from an upstream <em>Create Workspace</em> (or similar) node.
            </p>
            <footer className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button type="button" className={btnGhost} onClick={() => setPendingTools(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={confirmAddWorkspaceInput}>
                Add workspaceDir input
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
