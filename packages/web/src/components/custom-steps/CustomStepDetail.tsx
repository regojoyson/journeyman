import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { CustomAiStep, CustomAiStepUpdateInput } from "@journeyman/core";
import { customStepsApi, type ReadinessError } from "../../api/customSteps.ts";
import { Toggle } from "../Toggle.tsx";
import { btnPrimary, card } from "../../routes/admin-styles.ts";
import {
  isStepDirty,
  isSectionDirty,
  buildSectionUpdateInput,
  SAVEABLE_SECTION_IDS,
  statusLabel,
} from "./custom-step-form.ts";
import {
  CustomStepSectionNav,
  SECTIONS,
  type SectionId,
} from "./CustomStepSectionNav.tsx";
import { PromptSection }     from "./sections/PromptSection.tsx";
import { DefinitionSection } from "./sections/DefinitionSection.tsx";
import { InputsSection }     from "./sections/InputsSection.tsx";
import { OutputSection }     from "./sections/OutputSection.tsx";
import { ToolsSection }      from "./sections/ToolsSection.tsx";
import { SecretsSection }    from "./sections/SecretsSection.tsx";
import { DeleteSection }     from "./sections/DeleteSection.tsx";

const FIELD_TO_SECTION: Record<string, SectionId> = {
  name:           "definition",
  promptTemplate: "prompt",
};

const SECTION_SHORT_LABELS: Partial<Record<SectionId, string>> = {
  prompt:     "Prompt",
  definition: "Definition",
  inputs:     "Inputs",
  output:     "Output",
  tools:      "Tools",
  secrets:    "Secrets",
};

function SectionSaveBar({
  dirty,
  saving,
  locked,
  label,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  locked: boolean;
  label: string;
  onSave: () => void;
}) {
  if (!dirty) return null;
  return (
    <div className="shrink-0 border-t px-6 py-3 flex items-center justify-between bg-background">
      <span className="text-xs text-muted-foreground">● Unsaved changes</span>
      <button className={btnPrimary} disabled={locked || saving} onClick={onSave}>
        {saving ? "Saving…" : `Save ${label}`}
      </button>
    </div>
  );
}

export function CustomStepDetail({
  wsId,
  initial,
}: {
  wsId: string;
  initial: CustomAiStep;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawSection = params.get("section") ?? "prompt";
  const section = (SECTIONS.some((s) => s.id === rawSection) ? rawSection : "prompt") as SectionId;

  const [original, setOriginal] = useState<CustomAiStep>(initial);
  const [step, setStep] = useState<CustomAiStep>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readinessErrors, setReadinessErrors] = useState<ReadinessError[] | null>(null);

  const locked = step.enabled;
  const backTo = `/workspaces/${wsId}/custom-steps`;

  const sectionDirty = isSectionDirty(original, step, section);
  const dirtySections = SAVEABLE_SECTION_IDS.filter((id) => isSectionDirty(original, step, id));

  const patch = (p: CustomAiStepUpdateInput) => setStep((prev) => ({ ...prev, ...p }));
  const selectSection = (id: SectionId) => setParams({ section: id }, { replace: true });

  const guarded = (id: SectionId) => {
    if (sectionDirty && !confirm("You have unsaved changes in this section. Discard them?")) return;
    selectSection(id);
  };

  const mergeSection = (prev: CustomAiStep, updated: CustomAiStep, sectionId: SectionId): CustomAiStep => {
    const input = buildSectionUpdateInput(updated, sectionId);
    return { ...prev, ...(input as Partial<CustomAiStep>) };
  };

  const saveSection = async (sectionId: SectionId) => {
    setSaving(true);
    setError(null);
    try {
      const input = buildSectionUpdateInput(step, sectionId);
      const updated = await customStepsApi.update(wsId, step.id, input);
      setOriginal((prev) => mergeSection(prev, updated, sectionId));
      setStep((prev) => mergeSection(prev, updated, sectionId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnable = async () => {
    if (!step.enabled && isStepDirty(original, step)) {
      setError("Save your changes before enabling.");
      return;
    }
    setBusy(true);
    setError(null);
    setReadinessErrors(null);
    try {
      const updated = step.enabled
        ? await customStepsApi.disable(wsId, step.id)
        : await customStepsApi.enable(wsId, step.id);
      setOriginal(updated);
      setStep(updated);
    } catch (e: any) {
      if ((e as any).readinessErrors) {
        setReadinessErrors((e as any).readinessErrors as ReadinessError[]);
      } else {
        setError(e?.message ?? String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background px-6 pt-6 pb-4">
        <Link to={backTo} className="text-xs text-muted-foreground hover:text-foreground">
          ← Custom Steps
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{step.name}</h1>
              <span className="text-[11px] font-semibold tracking-wide rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                {statusLabel(step)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={step.enabled} disabled={busy} onChange={toggleEnable} label="Enabled" />
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">
        {readinessErrors && readinessErrors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-semibold text-destructive mb-2">
              ⚠ Can't enable — fix these issues first:
            </p>
            <ul className="space-y-1">
              {readinessErrors.map((e) => {
                const targetSection = FIELD_TO_SECTION[e.field] as SectionId | undefined;
                const label = targetSection
                  ? SECTIONS.find((s) => s.id === targetSection)?.label ?? e.field
                  : e.field;
                return (
                  <li key={e.field} className="text-sm text-destructive">
                    {targetSection ? (
                      <button
                        className="font-medium underline hover:no-underline"
                        onClick={() => selectSection(targetSection)}
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="font-medium">{label}</span>
                    )}
                    {" — "}{e.message}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {locked && (
          <div className="rounded-md bg-muted text-muted-foreground text-sm px-4 py-2">
            🔒 Enabled — disable to edit.
          </div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className={`${card} overflow-hidden`}>
          <div className="flex min-h-[500px]">
            <aside className="w-56 shrink-0 border-r p-3">
              <CustomStepSectionNav
                active={section}
                onSelect={guarded}
                dirtyIds={dirtySections as SectionId[]}
              />
            </aside>
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-6">
                {section === "prompt"     && <PromptSection     step={step} patch={patch} locked={locked} />}
                {section === "definition" && <DefinitionSection step={step} patch={patch} locked={locked} />}
                {section === "inputs"     && <InputsSection     step={step} patch={patch} locked={locked} />}
                {section === "output"     && <OutputSection     step={step} patch={patch} locked={locked} />}
                {section === "tools"      && <ToolsSection      step={step} patch={patch} locked={locked} />}
                {section === "secrets"    && <SecretsSection    step={step} patch={patch} locked={locked} />}
                {section === "delete"     && (
                  <DeleteSection
                    step={step}
                    wsId={wsId}
                    locked={locked}
                    onDeleted={() => navigate(backTo)}
                  />
                )}
              </div>
              <SectionSaveBar
                dirty={sectionDirty}
                saving={saving}
                locked={locked}
                label={SECTION_SHORT_LABELS[section] ?? ""}
                onSave={() => saveSection(section)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
