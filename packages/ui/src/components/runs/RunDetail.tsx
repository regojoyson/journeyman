// packages/ui/src/components/runs/RunDetail.tsx
import { useParams, Link } from 'react-router-dom';
import { useRunDetail, useLogs } from '@/api/runs';
import StepTimeline from './StepTimeline';
import LogPanel from '@/components/shared/LogPanel';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';

export default function RunDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data: run, isLoading, error } = useRunDetail(sessionId!, 10000);
  const [activeTab, setActiveTab] = useState<'timeline' | 'logs'>('timeline');
  const [activeStep, setActiveStep] = useState<string | null>(null);

  const logs = useLogs(sessionId!, activeStep ?? '');
  const hasLogs = !!activeStep;

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading run details...</span>
      </div>
    );
  }

  if (error || !run) {
    return (
      <EmptyState title="Run not found" description={`Session "${sessionId}" could not be loaded.`}>
        <Link to="/" className="text-sm text-blue-600 hover:underline">← Back to runs</Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Back to runs
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">{run.ticketKey}</h1>
            <StatusBadge status={run.status} size="md" />
            <span className="text-sm text-slate-500">{run.flowName}</span>
          </div>
          <p className="text-sm text-slate-400 font-mono">{run.sessionId}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`border-b-2 px-1 py-2 text-sm font-medium transition ${
              activeTab === 'timeline' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`border-b-2 px-1 py-2 text-sm font-medium transition ${
              activeTab === 'logs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Logs
            {hasLogs && <span className="ml-1 text-xs text-slate-400">({logs.data?.length ?? 0} lines)</span>}
          </button>
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'timeline' && <StepTimeline steps={run.steps} onStepClick={(s) => { setActiveTab('logs'); setActiveStep(s.stepId); }} />}

      {activeTab === 'logs' && hasLogs && <LogPanel lines={logs.data} loading={logs.isLoading} error={logs.error?.message} stepId={activeStep} />}
      {activeTab === 'logs' && !hasLogs && (
        <EmptyState title="No step selected" description="Click a step on the timeline to view its logs.">
          <button onClick={() => setActiveTab('timeline')} className="text-sm text-blue-600 hover:underline">Back to timeline</button>
        </EmptyState>
      )}
    </div>
  );
}
