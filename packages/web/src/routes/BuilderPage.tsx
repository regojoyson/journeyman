import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BuildPlan } from "@journeyman/core";
import { useAuth } from "../AuthContext.tsx";
import {
  createBuilderSession, applyBuilderPlan, streamBuilderChat,
  listBuilderSessions, patchBuilderSession, deleteBuilderSession,
  type BuilderSession,
} from "../api/builder.ts";
import { validateFlowDefinition, type FlowValidationReport } from "../api/flows.ts";
import { codingModelsApi } from "../api/codingModels.ts";
import { mcpApi } from "../api/mcp.ts";
import { sandboxesApi } from "../api/sandboxes.ts";
import { fetchVisibleSecrets } from "../api/secrets.ts";
import { reduceChatEvent, canApplyNow, type BuilderChatState, type ChatMsg } from "./builder-state.ts";
import { StepCard, type StepCardInventory } from "./StepCard.tsx";
import { SessionsSidebar } from "./SessionsSidebar.tsx";
import { setDefaultModel, setDefaultSandbox } from "./plan-edits.ts";
import { btnPrimary, card, inputCls } from "./admin-styles.ts";

const EMPTY: BuilderChatState = { messages: [], plan: null, error: null, streaming: false };

export function BuilderPage() {
  const { activeOrgId } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [state, setState] = useState<BuilderChatState>(EMPTY);
  const [sending, setSending] = useState(false);
  const [appliedFlowId, setAppliedFlowId] = useState<string | null>(null);
  const [validation, setValidation] = useState<FlowValidationReport | null>(null);

  // --- Sessions list ---
  const sessionsQ = useQuery({
    queryKey: ["builder-sessions", activeOrgId],
    queryFn: () => listBuilderSessions(activeOrgId!),
    enabled: !!activeOrgId,
  });

  // --- Inventory for the edit dropdowns ---
  const inventory = useInventory(activeOrgId);

  const plan = state.plan;

  // --- Debounced persist + re-validate whenever the edited plan changes ---
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!plan || !activeOrgId || !sessionId) return;
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(() => {
      void patchBuilderSession(activeOrgId, sessionId, { buildPlan: plan }).catch(() => {});
      void validateFlowDefinition(plan.workflow).then(setValidation).catch(() => setValidation(null));
    }, 500);
    return () => { if (debTimer.current) clearTimeout(debTimer.current); };
  }, [plan, activeOrgId, sessionId]);

  const applyM = useMutation({
    mutationFn: async () => {
      if (!activeOrgId || !sessionId) throw new Error("no session");
      return applyBuilderPlan(activeOrgId, sessionId);
    },
    onSuccess: (r) => { setAppliedFlowId(r.workflowId); void sessionsQ.refetch(); },
  });

  function resetToNew() {
    setSessionId(null);
    setState(EMPTY);
    setAppliedFlowId(null);
    setValidation(null);
    setInput("");
  }

  function resume(s: BuilderSession) {
    setSessionId(s.id);
    setState({ messages: s.messages as ChatMsg[], plan: s.buildPlan, error: null, streaming: false });
    setAppliedFlowId(s.appliedFlowId);
    setValidation(null);
  }

  async function remove(s: BuilderSession) {
    if (!activeOrgId) return;
    await deleteBuilderSession(activeOrgId, s.id).catch(() => {});
    if (s.id === sessionId) resetToNew();
    void sessionsQ.refetch();
  }

  async function send() {
    const message = input.trim();
    if (!message || !activeOrgId || sending) return;
    setInput("");
    setState((s) => ({ ...s, messages: [...s.messages, { role: "user", content: message } as ChatMsg], error: null, streaming: true }));
    setSending(true);
    try {
      let id = sessionId;
      if (!id) {
        const created = await createBuilderSession(activeOrgId, message.slice(0, 60));
        id = created.id;
        setSessionId(id);
        void sessionsQ.refetch();
      }
      await streamBuilderChat({
        orgId: activeOrgId, sessionId: id, message,
        onEvent: (ev) => setState((s) => reduceChatEvent(s, ev)),
      });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, streaming: false }));
    } finally {
      setSending(false);
    }
  }

  function onPlanChange(next: BuildPlan) {
    setState((s) => ({ ...s, plan: next }));
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-4 p-4">
      <SessionsSidebar
        sessions={sessionsQ.data ?? []}
        activeId={sessionId}
        onNew={resetToNew}
        onResume={resume}
        onDelete={(s) => void remove(s)}
      />

      {/* Chat */}
      <div className="flex w-2/5 flex-col">
        <h1 className="mb-3 text-lg font-medium text-slate-100">Builder</h1>
        <div className="flex-1 space-y-3 overflow-y-auto pr-2">
          {state.messages.map((m, i) => (
            <div key={i} className={m.role === "user"
              ? "ml-auto max-w-[85%] rounded-md bg-indigo-500/20 px-3 py-2 text-sm text-slate-100"
              : "mr-auto max-w-[85%] rounded-md bg-slate-800/70 px-3 py-2 text-sm text-slate-200"}>
              {m.content}
            </div>
          ))}
          {state.error && <div className="text-sm text-rose-300">Error: {state.error}</div>}
          {state.streaming && <div className="text-xs text-slate-500">…thinking</div>}
        </div>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="Describe the workflow you want…"
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }} disabled={sending} />
          <button className={btnPrimary} onClick={() => void send()} disabled={sending || !input.trim()}>Send</button>
        </div>
      </div>

      {/* Plan preview + editing */}
      <div className={`flex-1 overflow-y-auto p-4 ${card}`}>
        {!plan ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Describe a goal on the left and the plan will appear here.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-slate-100">Plan preview</p>
              <p className="text-sm text-slate-300">{plan.summary}</p>
            </div>

            {/* Workflow defaults */}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">
                Default model
                <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
                  list="default-models" defaultValue={plan.defaults.model ?? ""}
                  placeholder="(system default)"
                  onBlur={(e) => onPlanChange(setDefaultModel(plan, e.target.value))} />
                <datalist id="default-models">
                  {inventory.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </label>
              <label className="text-xs text-slate-400">
                Default sandbox
                <select className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
                  value={plan.defaults.sandboxId ?? ""}
                  onChange={(e) => onPlanChange(setDefaultSandbox(plan, e.target.value || null))}>
                  <option value="">(none)</option>
                  {inventory.sandboxes.map((sb) => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
                </select>
              </label>
            </div>

            {/* Editable step cards */}
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Steps</p>
              {plan.stepBindings.map((b) => (
                <StepCard key={b.nodeId} plan={plan} binding={b} inventory={inventory} onChange={onPlanChange} />
              ))}
            </div>

            {/* Gap footer + validation */}
            {plan.gaps.length > 0 && (
              <div className="text-xs text-amber-300/90">
                {plan.gaps.filter((g) => g.required).length} required ·{" "}
                {plan.gaps.filter((g) => !g.required).length} optional gap(s) remaining
              </div>
            )}
            {validation && !validation.ok && (
              <div className="text-xs text-rose-300">
                Validation: {validation.errors.concat(validation.missing).join("; ") || "failed"}
              </div>
            )}

            {appliedFlowId ? (
              <a className={btnPrimary} href={`/workflows/${appliedFlowId}/edit`}>Open the draft flow →</a>
            ) : (
              <button className={btnPrimary} disabled={!canApplyNow(plan, validation) || applyM.isPending}
                onClick={() => applyM.mutate()}>
                {applyM.isPending ? "Applying…" : "Apply"}
              </button>
            )}
            {applyM.isError && <p className="text-sm text-rose-300">{(applyM.error as Error).message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Load the edit dropdowns' option data. Failures degrade to empty lists. */
function useInventory(orgId: string | null): StepCardInventory {
  const models = useQuery({
    queryKey: ["coding-models", "claude"],
    queryFn: () => codingModelsApi.list("claude"),
    enabled: !!orgId,
  });
  const mcps = useQuery({
    queryKey: ["builder-mcps", orgId],
    queryFn: () => mcpApi.listMy(orgId!),
    enabled: !!orgId,
  });
  const sandboxes = useQuery({
    queryKey: ["builder-sandboxes", orgId],
    queryFn: () => sandboxesApi.listVisible(orgId!),
    enabled: !!orgId,
  });
  const secrets = useQuery({
    queryKey: ["builder-secrets", orgId],
    queryFn: () => fetchVisibleSecrets(orgId!),
    enabled: !!orgId,
  });
  return useMemo<StepCardInventory>(() => ({
    models: (models.data ?? []).map((m) => m.modelId),
    mcps: (mcps.data ?? []).map((m) => ({ id: m.id, name: m.name })),
    sandboxes: (sandboxes.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    secrets: (secrets.data ?? []).map((s) => s.name),
  }), [models.data, mcps.data, sandboxes.data, secrets.data]);
}
