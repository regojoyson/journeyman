import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { agentsApi } from "../../api/agents.ts";
import { btnPrimary, btnGhost, card, inputCls } from "../../routes/admin-styles.ts";
import { buildUpdateInput, isAgentDirty, agentSummary, statusLabel } from "./agent-form.ts";
import { SectionNav, SECTIONS, type SectionId } from "./sections/SectionNav.tsx";
import { InstructionsSection } from "./sections/InstructionsSection.tsx";
import { WorkspaceSection } from "./sections/WorkspaceSection.tsx";
import { TriggersSection } from "./sections/TriggersSection.tsx";
import { BehaviorSection } from "./sections/BehaviorSection.tsx";
import { PermissionsSection } from "./sections/PermissionsSection.tsx";
import { NotificationsSection } from "./sections/NotificationsSection.tsx";
import { RunHistorySection } from "./sections/RunHistorySection.tsx";

export function AgentDetail({ wsId, orgId: _orgId, initial }: { wsId: string; orgId: string; initial: Agent }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawSection = params.get("section") ?? "instructions";
  const section = (SECTIONS.some((s) => s.id === rawSection) ? rawSection : "instructions") as SectionId;

  const [original, setOriginal] = useState<Agent>(initial);
  const [a, setA] = useState<Agent>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRunForm, setShowRunForm] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});

  const locked = a.enabled;
  const dirty = isAgentDirty(original, a);
  const backTo = `/workspaces/${wsId}/agents`;

  const patch = (p: AgentUpdateInput) => setA((prev) => ({ ...prev, ...p } as Agent));
  const selectSection = (id: SectionId) => setParams({ section: id }, { replace: true });

  const guarded = (id: SectionId) => {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    selectSection(id);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await agentsApi.update(wsId, a.id, buildUpdateInput(a));
      setOriginal(updated);
      setA(updated);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = a.enabled ? await agentsApi.disable(wsId, a.id) : await agentsApi.enable(wsId, a.id);
      setOriginal(updated);
      setA(updated);
    } catch (e: any) {
      setError(e?.message ?? String(e));
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
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-8 space-y-6">
        <header>
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
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={a.enabled} disabled={busy} onChange={toggleEnable} />
                Enabled
              </label>
              <button className={btnGhost} disabled={busy} onClick={openRun}>Run now</button>
              <button className={btnPrimary} disabled={busy || locked || !dirty} onClick={save}>
                {dirty ? "Save changes" : "Saved"}
              </button>
            </div>
          </div>
        </header>

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
          <div className="flex">
            <aside className="w-56 shrink-0 border-r p-3">
              <SectionNav active={section} onSelect={guarded} />
            </aside>
            <div className="flex-1 p-6">
              {section === "instructions" && <InstructionsSection a={a} patch={patch} locked={locked} />}
              {section === "workspace" && <WorkspaceSection a={a} patch={patch} locked={locked} wsId={wsId} />}
              {section === "triggers" && <TriggersSection a={a} patch={patch} locked={locked} wsId={wsId} />}
              {section === "behavior" && <BehaviorSection a={a} patch={patch} locked={locked} />}
              {section === "permissions" && <PermissionsSection a={a} patch={patch} locked={locked} />}
              {section === "notifications" && <NotificationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}
              {section === "runs" && <RunHistorySection wsId={wsId} agentId={a.id} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
