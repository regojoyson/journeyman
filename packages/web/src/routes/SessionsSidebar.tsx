import type { BuilderSession } from "../api/builder.ts";
import { sessionLabel, sessionStatusBadge, orderSessions } from "./sessions-view.ts";

export function SessionsSidebar(props: {
  sessions: BuilderSession[];
  activeId: string | null;
  onNew: () => void;
  onResume: (s: BuilderSession) => void;
  onDelete: (s: BuilderSession) => void;
  onCollapse?: () => void;
}) {
  const { sessions, activeId, onNew, onResume, onDelete, onCollapse } = props;
  return (
    <div className="flex w-56 flex-none flex-col border-r border-slate-700 pr-3">
      <div className="mb-3 flex items-center gap-2">
        <button
          className="flex-1 rounded-md bg-primary/20 px-3 py-2 text-sm text-foreground hover:bg-primary/30"
          onClick={onNew}>
          + New build
        </button>
        {onCollapse && (
          <button
            className="rounded-md px-2 py-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="Hide sessions panel" onClick={onCollapse}>
            ‹
          </button>
        )}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {sessions.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">No past builds yet.</div>}
        {orderSessions(sessions).map((s) => (
          <div key={s.id}
            className={`group flex items-center justify-between rounded px-2 py-1.5 text-sm ${
              s.id === activeId ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-surface-hover"}`}>
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => onResume(s)} title={sessionLabel(s)}>
              <span className="truncate">{sessionLabel(s)}</span>
              <span className="ml-1 text-[10px] uppercase text-slate-500">{sessionStatusBadge(s)}</span>
            </button>
            <button
              className="ml-1 hidden text-slate-500 hover:text-danger group-hover:inline"
              title="Delete" onClick={() => onDelete(s)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
