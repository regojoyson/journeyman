import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowInstanceEvent } from "@journeyman/core";

type LogKind = "assistant" | "tool" | "tool_result" | "result_ok" | "result_err" | "other";

interface ParsedLog {
  id: number;
  ts: Date;
  line: string;
  kind: LogKind;
  meta?: Record<string, unknown>;
}

const KIND_COLOR: Record<LogKind, string> = {
  assistant: "#74b9ff",
  tool: "#fdcb6e",
  tool_result: "#a4b0be",
  result_ok: "#55efc4",
  result_err: "#ff7675",
  other: "#ddd",
};

const KIND_LABEL: Record<LogKind, string> = {
  assistant: "Assistant",
  tool: "Tools",
  tool_result: "Tool results",
  result_ok: "Results",
  result_err: "Errors",
  other: "Other",
};

function classify(line: string): LogKind {
  if (line.startsWith("🤖")) return "assistant";
  if (line.startsWith("🔧")) return "tool";
  if (line.startsWith("📥")) return "tool_result";
  if (line.startsWith("✅")) return "result_ok";
  if (line.startsWith("❌")) return "result_err";
  return "other";
}

function fmtTime(d: Date): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString(undefined, { hour12: false });
}

const NEAR_BOTTOM_THRESHOLD = 24; // px — within this distance of the bottom counts as "tailing".

export function PhaseLogsSection({ events }: { events: WorkflowInstanceEvent[] }) {
  const logs: ParsedLog[] = useMemo(
    () =>
      events
        .filter(e => e.eventType === "phase.log")
        .map(ev => {
          const payload = ev.payload as { line?: string; meta?: Record<string, unknown> };
          const line = payload.line ?? JSON.stringify(payload);
          return {
            id: ev.id,
            ts: ev.ts,
            line,
            kind: classify(line),
            meta: payload.meta,
          };
        }),
    [events],
  );

  const counts = useMemo(() => {
    const c: Partial<Record<LogKind, number>> = {};
    for (const l of logs) c[l.kind] = (c[l.kind] ?? 0) + 1;
    return c;
  }, [logs]);

  const allKinds: LogKind[] = ["assistant", "tool", "tool_result", "result_ok", "result_err", "other"];
  const [active, setActive] = useState<Record<LogKind, boolean>>({
    assistant: true, tool: true, tool_result: true,
    result_ok: true, result_err: true, other: true,
  });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef<boolean>(true);

  // Track whether the user is near the bottom *before* React commits the new
  // logs. This lets us decide whether to auto-stick-to-bottom on the next
  // layout pass.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distance <= NEAR_BOTTOM_THRESHOLD;
  }, [logs.length]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (autoScroll && wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  const toggleKind = (k: LogKind) => {
    setActive(prev => ({ ...prev, [k]: !prev[k] }));
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const scrollToTop = () => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = 0;
  };

  const scrollToBottom = () => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const filtered = useMemo(
    () => logs.filter(l => active[l.kind]),
    [logs, active],
  );

  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const copyAll = async () => {
    const text = filtered
      .map(l => {
        const head = `[${fmtTime(l.ts)}] ${l.line}`;
        const sub =
          l.meta && Object.keys(l.meta).length > 0
            ? `\n${JSON.stringify(l.meta, null, 2)}`
            : "";
        return head + sub;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  };

  return (
    <div className="je-runview__section">
      <div className="je-runview__log-header">
        <h3 style={{ margin: 0 }}>Logs ({filtered.length}{filtered.length !== logs.length ? ` / ${logs.length}` : ""})</h3>
        {logs.length > 0 && (
          <div className="je-runview__log-actions">
            <label className="je-runview__log-autoscroll" title="Auto-scroll to follow new logs">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
            <button
              type="button"
              className="je-runview__log-scrollbtn"
              onClick={scrollToTop}
              title="Scroll to top"
            >↑ Top</button>
            <button
              type="button"
              className="je-runview__log-scrollbtn"
              onClick={scrollToBottom}
              title="Scroll to bottom"
            >↓ Bottom</button>
            <button
              type="button"
              className="je-runview__log-scrollbtn"
              onClick={copyAll}
              disabled={filtered.length === 0}
              title="Copy all visible logs (includes expanded sub-data)"
            >
              {copyState === "copied" ? "✓ Copied" : copyState === "error" ? "Copy failed" : "⧉ Copy"}
            </button>
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <div className="je-runview__log-filters">
          {allKinds.map(k => {
            const n = counts[k] ?? 0;
            if (n === 0) return null;
            const on = active[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={`je-runview__log-chip${on ? " je-runview__log-chip--on" : ""}`}
                style={{ borderColor: KIND_COLOR[k], color: on ? "#1a1a24" : KIND_COLOR[k], background: on ? KIND_COLOR[k] : "transparent" }}
                title={`Toggle ${KIND_LABEL[k]}`}
              >
                {KIND_LABEL[k]} ({n})
              </button>
            );
          })}
        </div>
      )}

      <div ref={scrollerRef} className="je-runview__log">
        {logs.length === 0 && <div style={{ color: "#666" }}>(no logs yet)</div>}
        {logs.length > 0 && filtered.length === 0 && (
          <div style={{ color: "#666" }}>(all log types filtered out)</div>
        )}
        {filtered.map(l => {
          const isExpanded = expanded.has(l.id);
          const hasMeta = l.meta && Object.keys(l.meta).length > 0;
          return (
            <div key={l.id} className="je-runview__log-entry">
              <div
                className="je-runview__log-line"
                onClick={hasMeta ? () => toggleExpand(l.id) : undefined}
                style={{
                  cursor: hasMeta ? "pointer" : "default",
                  color: KIND_COLOR[l.kind],
                }}
                title={hasMeta ? "Click to expand raw SDK message" : undefined}
              >
                <span className="je-runview__log-time">{fmtTime(l.ts)}</span>
                {hasMeta && (
                  <span className="je-runview__log-caret">{isExpanded ? "▾" : "▸"}</span>
                )}
                <span>{l.line}</span>
              </div>
              {isExpanded && hasMeta && (
                <pre className="je-runview__log-meta">{JSON.stringify(l.meta, null, 2)}</pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
