// packages/ui/src/components/shared/LogPanel.tsx
import { useState } from 'react';
import { LogLine } from '@/types/api.types';
import { ChevronDown, ChevronUp, Terminal, Loader2 } from 'lucide-react';

interface LogPanelProps {
  lines?: LogLine[];
  loading?: boolean;
  error?: string;
  stepId: string;
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'text-slate-400',
  INFO: 'text-slate-500',
  WARN: 'text-amber-500',
  ERROR: 'text-rose-500',
};

export default function LogPanel({ lines, loading, error, stepId }: LogPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-600">
        Error loading logs: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading logs...
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between border-b border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-400" />
          <span>Logs for step: {stepId}</span>
          <span className="text-xs text-slate-400">({lines?.length ?? 0} lines)</span>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="max-h-[400px] overflow-auto bg-slate-950 p-4 font-mono text-xs">
          {lines && lines.length > 0 ? (
            lines.map(line => (
              <div key={line.id} className="leading-relaxed">
                <span className="text-slate-500">{line.timestamp}</span>{' '}
                <span className={`${LEVEL_COLORS[line.level] || 'text-slate-400'} font-medium`}>{line.level}</span>{' '}
                <span className="text-slate-300">{line.message}</span>
              </div>
            ))
          ) : (
            <div className="text-slate-500">No logs available for this step.</div>
          )}
        </div>
      )}
    </div>
  );
}
