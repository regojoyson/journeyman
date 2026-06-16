import { useEffect, useMemo, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type McpInstance, type TestOutcome, type ToolSummary } from "../../api/mcp.ts";

export interface TestMcpModalProps {
  orgId: string;
  scope: "user" | "org";
  mcp: McpInstance;
  onClose: () => void;
}

type Stage = "loading" | "list" | "invoking" | "result" | "error";

const MAX_DISPLAY_BYTES = 1_000_000;

export function TestMcpModal(props: TestMcpModalProps) {
  const [stage, setStage] = useState<Stage>("loading");
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [selected, setSelected] = useState<ToolSummary | null>(null);
  const [argsByTool, setArgsByTool] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [lastError, setLastError] = useState<{ error: string; phase: string } | null>(null);

  async function runList() {
    setStage("loading");
    setLastError(null);
    try {
      const out: TestOutcome = await mcpApi.testList(props.orgId, props.scope, props.mcp.id);
      if (out.ok && "tools" in out) {
        setTools(out.tools);
        setStage("list");
      } else if (!out.ok) {
        setLastError({ error: out.error, phase: out.phase });
        setStage("error");
      }
    } catch (e: any) {
      setLastError({ error: e?.message ?? "request failed", phase: "connect" });
      setStage("error");
    }
  }

  useEffect(() => { runList(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  function selectTool(t: ToolSummary) {
    setSelected(t);
    if (argsByTool[t.name] === undefined) {
      setArgsByTool((prev) => ({ ...prev, [t.name]: skeletonForSchema(t.inputSchema) }));
    }
    setParseError(null);
    setLastResult(null);
  }

  async function invoke() {
    if (!selected) return;
    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = JSON.parse(argsByTool[selected.name] ?? "{}");
      if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
        throw new Error("args must be a JSON object");
      }
    } catch (e: any) {
      setParseError(e?.message ?? "invalid JSON");
      return;
    }
    setParseError(null);
    setStage("invoking");
    try {
      const out: TestOutcome = await mcpApi.testInvoke(props.orgId, props.scope, props.mcp.id, selected.name, parsedArgs);
      if (out.ok && "result" in out) {
        setLastResult(out.result);
        setLastError(null);
        setStage("result");
      } else if (!out.ok) {
        setLastError({ error: out.error, phase: out.phase });
        setLastResult(null);
        setStage("result");
      }
    } catch (e: any) {
      setLastError({ error: e?.message ?? "request failed", phase: "invoke" });
      setLastResult(null);
      setStage("result");
    }
  }

  const onlyAuthenticate =
    tools.length === 1 && tools[0]?.name.toLowerCase() === "authenticate";

  const resultText = useMemo(() => {
    if (lastResult === null) return "";
    try { return JSON.stringify(lastResult, null, 2); }
    catch { return String(lastResult); }
  }, [lastResult]);

  const truncated = resultText.length > MAX_DISPLAY_BYTES;
  const resultDisplay = truncated ? resultText.slice(0, MAX_DISPLAY_BYTES) : resultText;

  function downloadFull() {
    const blob = new Blob([resultText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.mcp.name}-${selected?.name ?? "result"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyResult() {
    void navigator.clipboard.writeText(resultText);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col`}>
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Test MCP</h2>
            <div className="text-sm text-slate-400">
              <code className={codePill}>{props.mcp.name}</code>
              <span className="ml-2">transport: <code className={codePill}>{props.mcp.transport}</code></span>
            </div>
          </div>
          <button onClick={props.onClose} className={btnGhost}>Close</button>
        </div>

        {stage === "loading" && (
          <div className="p-10 text-center text-sm text-slate-400">Connecting to <code className={codePill}>{props.mcp.name}</code>…</div>
        )}

        {stage === "error" && lastError && (
          <div className="p-6 space-y-3">
            <div className="rounded border border-rose-700/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              <div className="font-medium">Test failed at phase: <code className={codePill}>{lastError.phase}</code></div>
              <div className="mt-1 whitespace-pre-wrap break-words">{lastError.error}</div>
            </div>
            <button onClick={runList} className={btnPrimary}>Retry</button>
          </div>
        )}

        {(stage === "list" || stage === "invoking" || stage === "result") && (
          <div className="flex flex-1 min-h-0 flex-col md:flex-row">
            <aside className="md:w-72 md:border-r md:border-slate-800 overflow-y-auto p-4 space-y-1">
              {onlyAuthenticate && (
                <div className="rounded border border-amber-700/40 bg-warning/10 px-3 py-2 text-xs text-warning mb-2">
                  Server returned only an <code className={codePill}>authenticate</code> tool. This usually means auth is missing or invalid — check the bound secret and required env.
                </div>
              )}
              {tools.length === 0 ? (
                <div className="text-sm text-slate-500">No tools.</div>
              ) : tools.map((t) => (
                <button
                  key={t.name}
                  onClick={() => selectTool(t)}
                  className={`w-full text-left px-3 py-2 rounded text-sm ${selected?.name === t.name ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/50"}`}
                >
                  <div className="font-mono">{t.name}</div>
                  {t.description && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{t.description}</div>}
                </button>
              ))}
            </aside>

            <section className="flex-1 overflow-y-auto p-6">
              {!selected && (
                <div className="text-sm text-slate-500">Select a tool to invoke.</div>
              )}

              {selected && stage !== "result" && (
                <div className="space-y-4">
                  <div>
                    <div className="font-mono text-slate-100">{selected.name}</div>
                    {selected.description && <div className="text-sm text-slate-400 mt-1">{selected.description}</div>}
                  </div>

                  <div>
                    <label className="text-sm text-slate-300 block mb-1">Arguments (JSON)</label>
                    <textarea
                      className={`${inputCls} font-mono`}
                      rows={12}
                      value={argsByTool[selected.name] ?? ""}
                      onChange={(e) => setArgsByTool((prev) => ({ ...prev, [selected.name]: e.target.value }))}
                    />
                    {parseError && <div className="text-sm text-danger mt-1">{parseError}</div>}
                  </div>

                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer">inputSchema</summary>
                    <pre className="mt-2 bg-slate-900/60 rounded p-3 overflow-x-auto">{JSON.stringify(selected.inputSchema ?? {}, null, 2)}</pre>
                  </details>

                  <div className="flex justify-end">
                    <button onClick={invoke} disabled={stage === "invoking"} className={btnPrimary}>
                      {stage === "invoking" ? "Invoking…" : "Invoke"}
                    </button>
                  </div>
                </div>
              )}

              {selected && stage === "result" && (
                <div className="space-y-4">
                  {lastError ? (
                    <div className="rounded border border-rose-700/40 bg-danger/10 px-4 py-3 text-sm text-danger">
                      <div className="font-medium">Failed at phase: <code className={codePill}>{lastError.phase}</code></div>
                      <div className="mt-1 whitespace-pre-wrap break-words">{lastError.error}</div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-slate-300">Result</div>
                        <div className="flex gap-2">
                          <button onClick={copyResult} className={btnGhost}>Copy</button>
                          {truncated && <button onClick={downloadFull} className={btnGhost}>Download full</button>}
                        </div>
                      </div>
                      {truncated && (
                        <div className="text-xs text-warning">Result truncated for display ({resultText.length.toLocaleString()} bytes). Use "Download full" for the complete payload.</div>
                      )}
                      <pre className="bg-slate-900/60 rounded p-3 overflow-auto max-h-[50vh] text-xs whitespace-pre-wrap break-words">{resultDisplay}</pre>
                    </>
                  )}
                  <div className="flex justify-end">
                    <button onClick={() => setStage("list")} className={btnPrimary}>Run again</button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function skeletonForSchema(schema: unknown): string {
  const required = Array.isArray((schema as any)?.required) ? (schema as any).required as string[] : [];
  const props = ((schema as any)?.properties ?? {}) as Record<string, any>;
  const obj: Record<string, unknown> = {};
  for (const key of required) {
    const t = props[key]?.type;
    obj[key] =
      t === "number" || t === "integer" ? 0
      : t === "boolean" ? false
      : t === "array" ? []
      : t === "object" ? {}
      : "";
  }
  return JSON.stringify(obj, null, 2);
}
