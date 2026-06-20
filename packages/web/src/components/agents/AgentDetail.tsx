import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { agentsApi } from "../../api/agents.ts";
import type { ReadinessError } from "../../api/agents.ts";
import { Toggle } from "../Toggle.tsx";
import { btnPrimary, btnGhost, card, inputCls } from "../../routes/admin-styles.ts";
import { isAgentDirty, isSectionDirty, buildSectionUpdateInput, SAVEABLE_SECTION_IDS, agentSummary, statusLabel } from "./agent-form.ts";
import { SectionNav, SECTIONS, type SectionId } from "./sections/SectionNav.tsx";
import { InstructionsSection } from "./sections/InstructionsSection.tsx";
import { WorkspaceSection } from "./sections/WorkspaceSection.tsx";
import { TriggersSection } from "./sections/TriggersSection.tsx";
import { BehaviorSection } from "./sections/BehaviorSection.tsx";
import { PermissionsSection } from "./sections/PermissionsSection.tsx";
import { NotificationsSection } from "./sections/NotificationsSection.tsx";
import { RunHistorySection } from "./sections/RunHistorySection.tsx";
import { DeleteSection } from "./sections/DeleteSection.tsx";

const FIELD_TO_SECTION: Record<string, SectionId> = {
  name:         "instructions",
  instructions: "instructions",
  inputs:       "instructions",
  provider:     "workspace",
  model:        "workspace",
  sandbox:      "workspace",
  triggers:     "triggers",
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

export function AgentDetail({ wsId, orgId, initial }: { wsId: string; orgId: string; initial: Agent }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawSection = params.get("section") ?? "instructions";
  const section = (SECTIONS.some((s) => s.id === rawSection) ? rawSection : "instructions") as SectionId;

  const [original, setOriginal] = useState<Agent>(initial);
  const [a, setA] = useState<Agent>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readinessErrors, setReadinessErrors] = useState<ReadinessError[] | null>(null);
  const [showRunForm, setShowRunForm] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});

  const locked = a.enabled;
  const backTo = `/workspaces/${wsId}/agents`;

  const sectionDirty = isSectionDirty(original, a, section);
  const dirtySections = SAVEABLE_SECTION_IDS.filter((id) => isSectionDirty(original, a, id));

  const SECTION_SHORT_LABELS: Partial<Record<SectionId, string>> = {
    instructions: "Instructions",
    workspace: "Workspace",
    triggers: "Triggers",
    behavior: "Behavior",
    permissions: "Permissions",
    notifications: "Notifications",
  };

  const patch = (p: AgentUpdateInput) => setA((prev) => ({ ...prev, ...p } as Agent));
  const selectSection = (id: SectionId) => setParams({ section: id }, { replace: true });

  const guarded = (id: SectionId) => {
    if (sectionDirty && !confirm("You have unsaved changes in this section. Discard them?")) return;
    selectSection(id);
  };

  const mergeSection = (prev: Agent, updated: Agent, sectionId: SectionId): Agent => {
    const input = buildSectionUpdateInput(updated, sectionId);
    return { ...prev, ...(input as Partial<Agent>) };
  };

  const saveSection = async (sectionId: SectionId) => {
    setSaving(true);
    setError(null);
    try {
      const input = buildSectionUpdateInput(a, sectionId);
      const updated = await agentsApi.update(wsId, a.id, input);
      setOriginal((prev) => mergeSection(prev, updated, sectionId));
      setA((prev) => mergeSection(prev, updated, sectionId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnable = async () => {
    if (!a.enabled && isAgentDirty(original, a)) {
      setError("Save your changes before enabling.");
      return;
    }
    setBusy(true);
    setError(null);
    setReadinessErrors(null);
    try {
      const updated = a.enabled
        ? await agentsApi.disable(wsId, a.id)
        : await agentsApi.enable(wsId, a.id);
      setReadinessErrors(null);
      setOriginal(updated);
      setA(updated);
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

  const openRun = () => {
    if (a.inputs.length === 0) {
      void runNow({});
      return;
    }
    setRunInputs(Object.fromEntries(a.inputs.map((i) => [i.name, ""])));
    setShowRunForm(true);
  };

  const runNow = async (inputs: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await agentsApi.runNow(wsId, a.id, inputs);
      setShowRunForm(false);
      selectSection("runs");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background px-6 pt-6 pb-4">
        <Link to={backTo} className="text-xs text-muted-foreground hover:text-foreground">← Agents</Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{a.name}</h1>
              <span className="text-[11px] font-semibold tracking-wide rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                {statusLabel(a)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{agentSummary(a)}</p>
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={a.enabled} disabled={busy} onChange={toggleEnable} label="Enabled" />
            <span title={!a.enabled ? "Enable the agent to run it" : undefined}>
              <button className={btnGhost} disabled={busy || !a.enabled} onClick={openRun}>Run now</button>
            </span>
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
        {showRunForm && (
          <div className={`${card} p-4 space-y-3`}>
            <div className="font-medium text-sm">Run now — provide inputs</div>
            {a.inputs.map((inp) => (
              <div key={inp.name} className="flex items-center gap-2">
                <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
                <input
                  className={inputCls}
                  value={runInputs[inp.name] ?? ""}
                  onChange={(e) => setRunInputs((prev) => ({ ...prev, [inp.name]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy} onClick={() => runNow(runInputs)}>Run</button>
              <button className={btnGhost} disabled={busy} onClick={() => setShowRunForm(false)}>Cancel</button>
            </div>
          </div>
        )}
        {error && <div className="text-sm text-destructive">{error}</div>}

        <div className={`${card} overflow-hidden`}>
          <div className="flex min-h-[500px]">
            <aside className="w-56 shrink-0 border-r p-3">
              <SectionNav active={section} onSelect={guarded} dirtyIds={dirtySections as SectionId[]} />
            </aside>
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-6">
                {section === "instructions" && <InstructionsSection a={a} patch={patch} locked={locked} />}
                {section === "workspace" && <WorkspaceSection a={a} patch={patch} locked={locked} wsId={wsId} orgId={orgId} />}
                {section === "triggers" && <TriggersSection a={a} patch={patch} locked={locked} wsId={wsId} />}
                {section === "behavior" && <BehaviorSection a={a} patch={patch} locked={locked} />}
                {section === "permissions" && <PermissionsSection a={a} patch={patch} locked={locked} />}
                {section === "notifications" && <NotificationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}
                {section === "runs" && <RunHistorySection wsId={wsId} agentId={a.id} />}
                {section === "delete" && (
                  <DeleteSection a={a} wsId={wsId} locked={locked} onDeleted={() => navigate(backTo)} />
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
