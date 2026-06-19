import { useState } from "react";
import type {
  CustomAiStep, CustomAiStepCreateInput, CustomStepInputField,
  CustomStepOutputMode, CustomStepOutputField,
  CanonicalTool, SecretSlotDef,
} from "@journeyman/core";
import {
  FileText, ListChecks, Send, Wrench, KeyRound, Sparkles, X, AlertTriangle,
} from "lucide-react";
import { InputFieldsEditor } from "./InputFieldsEditor.tsx";
import { OutputSchemaEditor } from "./OutputSchemaEditor.tsx";
import { ToolsPicker } from "./ToolsPicker.tsx";
import { SecretsEditor } from "./SecretsEditor.tsx";
import { PromptEditor } from "./prompt-editor/PromptEditor.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { btnGhost, btnPrimary, inputCls } from "../../routes/admin-styles.ts";

type TabId = "definition" | "inputs" | "output" | "tools" | "secrets" | "prompt";

const TABS: Array<{ id: TabId; label: string; icon: typeof FileText }> = [
  { id: "definition", label: "Definition", icon: FileText },
  { id: "inputs",     label: "Inputs",     icon: ListChecks },
  { id: "output",     label: "Output",     icon: Send },
  { id: "tools",      label: "Tools",      icon: Wrench },
  { id: "secrets",    label: "Secrets",    icon: KeyRound },
  { id: "prompt",     label: "Prompt",     icon: Sparkles },
];

export function EditCustomStepModal(props: {
  initial?: CustomAiStep;
  scope: "user" | "org";
  onCancel: () => void;
  onSave: (body: CustomAiStepCreateInput) => Promise<void>;
}) {
  const { initial, scope, onCancel, onSave } = props;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<string | null>(initial?.icon ?? null);
  const [inputFields, setInputFields] = useState<CustomStepInputField[]>(initial?.inputFields ?? []);
  const [outputMode, setOutputMode] = useState<CustomStepOutputMode>(initial?.outputMode ?? "none");
  const [outputFields, setOutputFields] = useState<CustomStepOutputField[]>(initial?.outputFields ?? []);
  const [promptTemplate, setPromptTemplate] = useState(initial?.promptTemplate ?? "");
  const [defaultTools, setDefaultTools] = useState<CanonicalTool[]>(initial?.defaultTools ?? []);
  const [slots, setSlots] = useState<SecretSlotDef[]>(initial?.slots ?? []);
  const [requiresSkills, setRequiresSkills] = useState<boolean>(initial?.requiresSkills ?? false);
  const [requiresMcp, setRequiresMcp] = useState<boolean>(initial?.requiresMcp ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("definition");

  const handleToolsChange = (next: CanonicalTool[]) => {
    setDefaultTools(next);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        name, description,
        icon,
        inputFields,
        outputMode,
        outputFields: outputMode === "structured" ? outputFields : undefined,
        promptTemplate,
        defaultTools,
        defaultMcpIds: initial?.defaultMcpIds ?? [],
        defaultSkillIds: initial?.defaultSkillIds ?? [],
        requiresSkills,
        requiresMcp,
        slots,
      });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Status badges for each tab so the user knows what's filled in.
  const tabBadge: Record<TabId, string | null> = {
    definition: name ? null : "!",
    inputs: inputFields.length > 0 ? String(inputFields.length) : null,
    output: outputMode !== "none" ? outputMode : null,
    tools: defaultTools.length > 0 ? String(defaultTools.length) : null,
    secrets: slots.length > 0 ? String(slots.length) : null,
    prompt: promptTemplate.trim() ? null : "!",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 md:p-6">
      <div className="bg-bg border border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-start justify-between px-5 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-foreground" />
              {initial ? "Edit custom step" : "New custom step"}
              <span className="text-[11px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                {scope}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Define a reusable AI step: typed inputs, optional structured output, prompt and tools.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-slate-500 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Tabs */}
        <nav className="flex items-center gap-1 px-3 pt-3 border-b border-slate-700 bg-bg">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            const badge = tabBadge[t.id];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={
                  "relative inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-md transition " +
                  (active
                    ? "bg-slate-900 text-slate-100 border-b-2 border-indigo-400 -mb-px"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50")
                }
              >
                <Icon className="w-4 h-4" />
                {t.label}
                {badge && (
                  <span className={
                    "ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full " +
                    (badge === "!"
                      ? "bg-danger/10 text-danger border border-danger/25"
                      : "bg-slate-800 text-slate-300 border border-slate-700")
                  }>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-surface-hover p-6">
          <div className="w-full">
            {activeTab === "definition" && (
              <section className="space-y-4">
                <SectionHeader title="Definition" hint="How this step identifies itself in the catalog." />
                <label className="block text-xs font-medium text-slate-300">
                  Name
                  <input
                    className={`${inputCls} mt-1`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Push branch and open PR"
                  />
                </label>
                <label className="block text-xs font-medium text-slate-300">
                  Description
                  <textarea
                    className={`${inputCls} mt-1`}
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this step does, and when a flow author would reach for it."
                  />
                </label>
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-300">Icon</div>
                  <IconPicker value={icon} onChange={setIcon} />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={requiresSkills}
                      onChange={(e) => setRequiresSkills(e.target.checked)}
                    />
                    <span>Skills required</span>
                  </label>
                  <p className="text-[11px] text-slate-500 mt-1 ml-6">
                    Workflows using this step must have at least one skill attached.
                  </p>
                  {requiresSkills && (initial?.defaultSkillIds?.length ?? 0) === 0 && (
                    <p className="text-[11px] text-warning mt-1 ml-6">
                      ⚠ No default skills set. Flow authors will have to pick skills manually each time.
                      Consider adding defaults so the step works out of the box.
                    </p>
                  )}
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={requiresMcp}
                      onChange={(e) => setRequiresMcp(e.target.checked)}
                    />
                    <span>MCP required</span>
                  </label>
                  <p className="text-[11px] text-slate-500 mt-1 ml-6">
                    Workflows using this step must have at least one MCP attached.
                  </p>
                  {requiresMcp && (initial?.defaultMcpIds?.length ?? 0) === 0 && (
                    <p className="text-[11px] text-warning mt-1 ml-6">
                      ⚠ No default MCPs set. Flow authors will have to pick MCPs manually each time.
                      Consider adding defaults so the step works out of the box.
                    </p>
                  )}
                </div>
              </section>
            )}

            {activeTab === "inputs" && (
              <section className="space-y-4">
                <SectionHeader
                  title="Inputs"
                  hint="Declared inputs are wirable in the flow editor. Reference them in the prompt with {{name}}."
                />
                <InputFieldsEditor value={inputFields} onChange={setInputFields} />
              </section>
            )}

            {activeTab === "output" && (
              <section className="space-y-4">
                <SectionHeader
                  title="Output"
                  hint="Structured output is validated against your JSON schema by the model SDK."
                />
                <OutputSchemaEditor
                  mode={outputMode}
                  fields={outputFields}
                  onModeChange={setOutputMode}
                  onFieldsChange={setOutputFields}
                />
              </section>
            )}

            {activeTab === "tools" && (
              <section className="space-y-4">
                <SectionHeader
                  title="Tools"
                  hint="Pick the canonical tools the step prompt may use."
                />
                <ToolsPicker value={defaultTools} onChange={handleToolsChange} />
              </section>
            )}

            {activeTab === "secrets" && (
              <section className="space-y-4">
                <SectionHeader
                  title="Secrets"
                  hint="Credentials this step needs at runtime. Flow authors bind each slot per node."
                />
                <SecretsEditor
                  value={slots}
                  onChange={setSlots}
                  hasBashTool={defaultTools.includes("bash")}
                />
              </section>
            )}

            {activeTab === "prompt" && (
              <section className="space-y-3">
                <SectionHeader
                  title="Prompt"
                  hint="The instructions the model receives. Click chips on the right to insert tokens at the cursor."
                />
                <PromptEditor
                  value={promptTemplate}
                  onChange={setPromptTemplate}
                  inputFields={inputFields}
                  slots={slots}
                />
              </section>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between px-5 py-3 border-t border-slate-700 bg-bg">
          <div className="text-xs">
            {error && (
              <div className="flex items-center gap-1.5 text-danger">
                <AlertTriangle className="w-3.5 h-3.5" />
                {error}
              </div>
            )}
            {!error && !name.trim() && (
              <div className="text-slate-500">Name is required to save.</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={btnGhost} onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={submit}
              disabled={submitting || !name.trim()}
            >
              {submitting ? "Saving…" : (initial ? "Save changes" : "Create step")}
            </button>
          </div>
        </footer>
      </div>

    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold text-slate-100">{title}</h3>
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  );
}
