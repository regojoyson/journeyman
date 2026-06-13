import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../AuthContext.tsx";
import {
  createBuilderSession, applyBuilderPlan, streamBuilderChat, type BuilderSession,
} from "../api/builder.ts";
import {
  reduceChatEvent, canApply, type BuilderChatState, type ChatMsg,
} from "./builder-state.ts";
import { btnPrimary, card, inputCls } from "./admin-styles.ts";

export function BuilderPage() {
  const { activeOrgId } = useAuth();
  const sessionRef = useRef<BuilderSession | null>(null);
  const [input, setInput] = useState("");
  const [state, setState] = useState<BuilderChatState>({ messages: [], plan: null, error: null, streaming: false });
  const [sending, setSending] = useState(false);
  const [appliedFlowId, setAppliedFlowId] = useState<string | null>(null);

  const applyM = useMutation({
    mutationFn: async () => {
      if (!activeOrgId || !sessionRef.current) throw new Error("no session");
      return applyBuilderPlan(activeOrgId, sessionRef.current.id);
    },
    onSuccess: (r) => setAppliedFlowId(r.workflowId),
  });

  async function send() {
    const message = input.trim();
    if (!message || !activeOrgId || sending) return;
    setInput("");
    setState((s) => ({ ...s, messages: [...s.messages, { role: "user", content: message } as ChatMsg], error: null, streaming: true }));
    setSending(true);
    try {
      if (!sessionRef.current) {
        sessionRef.current = await createBuilderSession(activeOrgId, message.slice(0, 60));
      }
      await streamBuilderChat({
        orgId: activeOrgId, sessionId: sessionRef.current.id, message,
        onEvent: (ev) => setState((s) => reduceChatEvent(s, ev)),
      });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, streaming: false }));
    } finally {
      setSending(false);
    }
  }

  const plan = state.plan;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-4 p-4">
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

      {/* Plan preview */}
      <div className={`w-3/5 overflow-y-auto p-4 ${card}`}>
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

            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Steps</p>
              <ol className="space-y-1">
                {plan.stepBindings.map((b) => (
                  <li key={b.nodeId} className="flex items-center gap-2 text-sm text-slate-200">
                    <span className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">{b.stepKind}</span>
                    {b.nodeId}
                  </li>
                ))}
              </ol>
            </div>

            {plan.gaps.length > 0 && (
              <div className="rounded-md border border-amber-900/40 bg-amber-950/30 p-3">
                <p className="mb-1 text-sm font-medium text-amber-300">Gaps</p>
                <ul className="space-y-1 text-sm text-amber-200/90">
                  {plan.gaps.map((g) => (
                    <li key={g.id}>{g.required ? "⚠️ " : "• "}{g.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {appliedFlowId ? (
              <a className={btnPrimary} href={`/workflows/${appliedFlowId}/edit`}>Open the draft flow →</a>
            ) : (
              <button className={btnPrimary} disabled={!canApply(plan) || applyM.isPending}
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
