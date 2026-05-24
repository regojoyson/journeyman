import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowInstanceEvent, WorkflowNode } from "@journeyman/core";
import { parseLogs } from "./parse-logs.ts";
import {
  ALL_KINDS,
  KIND_COLOR,
  KIND_LABEL,
  type LogKind,
  type ParsedLog,
} from "./types.ts";

export interface WorkflowLogsPanelProps {
  events: WorkflowInstanceEvent[];
  nodes: WorkflowNode[];
  height: number;
  onResizeHeight: (next: number) => void;
  onClose: () => void;
}

const NEAR_BOTTOM_THRESHOLD = 24;

function fmtTime(d: Date): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toLocaleTimeString(undefined, { hour12: false });
}

export function WorkflowLogsPanel(props: WorkflowLogsPanelProps) {
  const allLogs: ParsedLog[] = useMemo(
    () => parseLogs(props.events, props.nodes),
    [props.events, props.nodes],
  );

  const [activeKinds, setActiveKinds] = useState<Record<LogKind, boolean>>({
    assistant: true, tool: true, tool_result: true,
    result_ok: true, result_err: true, other: true,
  });
  const [activeSteps, setActiveSteps] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const stepChips = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of allLogs) {
      if (l.nodeId && !seen.has(l.nodeId)) seen.set(l.nodeId, l.stepName);
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [allLogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLogs.filter(l => {
      if (!activeKinds[l.kind]) return false;
      if (activeSteps.size > 0) {
        if (!l.nodeId || !activeSteps.has(l.nodeId)) return false;
      }
      if (q && !l.line.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allLogs, activeKinds, activeSteps, search]);

  const kindCounts = useMemo(() => {
    const c: Partial<Record<LogKind, number>> = {};
    for (const l of allLogs) c[l.kind] = (c[l.kind] ?? 0) + 1;
    return c;
  }, [allLogs]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef<boolean>(true);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distance <= NEAR_BOTTOM_THRESHOLD;
  }, [filtered.length]);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (autoScroll && wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dy = ev.clientY - dragRef.current.startY;
      props.onResizeHeight(dragRef.current.startHeight - dy);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [props.onResizeHeight]);

  const onHandleMouseDown = (ev: React.MouseEvent) => {
    dragRef.current = { startY: ev.clientY, startHeight: props.height };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  const toggleKind = (k: LogKind) =>
    setActiveKinds(prev => ({ ...prev, [k]: !prev[k] }));

  const toggleStep = (nodeId: string) =>
    setActiveSteps(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const clearSteps = () => setActiveSteps(new Set());

  const toggleExpand = (id: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const scrollToTop = () => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  };
  const scrollToBottom = () => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  };

  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyAll = async () => {
    const text = filtered
      .map(l => {
        const head = `[${fmtTime(l.ts)}] [${l.stepName}] ${l.line}`;
        const sub = l.meta && Object.keys(l.meta).length > 0
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
    <div className="je-runview__logspanel" style={{ height: props.height }}>
      <div
        className="je-runview__logspanel-handle"
        onMouseDown={onHandleMouseDown}
        title="Drag to resize"
      >
        <span /><span /><span />
      </div>

      <div className="je-runview__logspanel-header">
        <h3 style={{ margin: 0 }}>
          Logs ({filtered.length}{filtered.length !== allLogs.length ? ` / ${allLogs.length}` : ""})
        </h3>
        <input
          type="text"
          className="je-runview__logspanel-search"
          placeholder="Filter logs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="je-runview__log-actions">
          <label className="je-runview__log-autoscroll" title="Auto-scroll to follow new logs">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button type="button" className="je-runview__log-scrollbtn" onClick={scrollToTop} title="Scroll to top">↑ Top</button>
          <button type="button" className="je-runview__log-scrollbtn" onClick={scrollToBottom} title="Scroll to bottom">↓ Bottom</button>
          <button
            type="button"
            className="je-runview__log-scrollbtn"
            onClick={copyAll}
            disabled={filtered.length === 0}
            title="Copy all visible logs"
          >
            {copyState === "copied" ? "✓ Copied" : copyState === "error" ? "Copy failed" : "⧉ Copy"}
          </button>
          <button
            type="button"
            className="je-runview__log-scrollbtn"
            onClick={props.onClose}
            title="Close logs panel"
          >✕</button>
        </div>
      </div>

      {allLogs.length > 0 && (
        <div className="je-runview__log-filters">
          {ALL_KINDS.map(k => {
            const n = kindCounts[k] ?? 0;
            if (n === 0) return null;
            const on = activeKinds[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={`je-runview__log-chip${on ? " je-runview__log-chip--on" : ""}`}
                style={{
                  borderColor: KIND_COLOR[k],
                  color: on ? "#1a1a24" : KIND_COLOR[k],
                  background: on ? KIND_COLOR[k] : "transparent",
                }}
                title={`Toggle ${KIND_LABEL[k]}`}
              >
                {KIND_LABEL[k]} ({n})
              </button>
            );
          })}
        </div>
      )}

      {stepChips.length > 0 && (
        <div className="je-runview__log-filters">
          <button
            type="button"
            onClick={clearSteps}
            className={`je-runview__log-chip${activeSteps.size === 0 ? " je-runview__log-chip--on" : ""}`}
            style={{
              borderColor: "#888",
              color: activeSteps.size === 0 ? "#1a1a24" : "#aaa",
              background: activeSteps.size === 0 ? "#888" : "transparent",
            }}
            title="Show all steps"
          >All steps</button>
          {stepChips.map(p => {
            const on = activeSteps.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleStep(p.id)}
                className={`je-runview__log-chip${on ? " je-runview__log-chip--on" : ""}`}
                style={{
                  borderColor: "#7d8aff",
                  color: on ? "#1a1a24" : "#7d8aff",
                  background: on ? "#7d8aff" : "transparent",
                }}
                title={`Toggle step ${p.name}`}
              >{p.name}</button>
            );
          })}
        </div>
      )}

      <div ref={scrollerRef} className="je-runview__log je-runview__logspanel-list">
        {allLogs.length === 0 && <div style={{ color: "#666" }}>(no logs yet)</div>}
        {allLogs.length > 0 && filtered.length === 0 && (
          <div style={{ color: "#666" }}>(all filters hide every log)</div>
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
                title={hasMeta ? "Click to expand event payload" : undefined}
              >
                <span className="je-runview__log-time">{fmtTime(l.ts)}</span>
                <span
                  className="je-runview__log-step"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (l.nodeId) setActiveSteps(new Set([l.nodeId]));
                  }}
                  title={l.nodeId ? `Filter to step: ${l.stepName}` : undefined}
                  style={{ cursor: l.nodeId ? "pointer" : "default" }}
                >{l.stepName}</span>
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
