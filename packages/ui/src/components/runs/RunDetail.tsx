import { useParams, Link, useNavigate } from 'react-router-dom';
import { useRunDetail, useLogs, useCancelRun, useDeleteRun, useResumeRun } from '@/api/runs';
import StepTimeline from './StepTimeline';
import RunContext from './RunContext';
import LogPanel from '@/components/shared/LogPanel';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { ArrowLeft, Loader2, Clock, GitBranch, Tag, Calendar, XCircle, Trash2, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { formatDuration } from '@/utils/format';
import type { RunStep } from '@/types/api.types';

export default function RunDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { data: run, isLoading, error } = useRunDetail(sessionId!);
  const [activeTab, setActiveTab] = useState<'timeline' | 'context' | 'logs'>('timeline');
  const [activeStep, setActiveStep] = useState<RunStep | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const logs = useLogs(sessionId!, activeStep?.id ?? null);
  const cancelRun = useCancelRun();
  const deleteRun = useDeleteRun();
  const resumeRun = useResumeRun();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading run…</span>
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

  const totalMs = run.steps.reduce((s, step) => s + (step.durationMs ?? 0), 0);
  const completedSteps = run.steps.filter(s => s.status === 'ok').length;

  // Merge started steps with pending steps from the flow snapshot so the
  // timeline always shows the full set of steps, not just the ones that ran.
  const startedById = new Map(run.steps.map(s => [s.id, s]));
  const allSteps: RunStep[] = (run.flowSnapshot?.steps ?? []).map(fs =>
    startedById.get(fs.id) ?? {
      id: fs.id, phase: fs.phase, attempt: 1, status: 'pending' as const,
      startedAt: null, endedAt: null, durationMs: null,
    }
  );
  // If there's no flowSnapshot fall back to the steps we have
  const displaySteps = allSteps.length > 0 ? allSteps : run.steps;
  const totalSteps = displaySteps.length;

  function handleStepClick(step: RunStep) {
    setActiveStep(step);
    setActiveTab('logs');
  }

  async function handleDelete() {
    await deleteRun.mutateAsync({ sessionId: sessionId! });
    navigate('/');
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to runs
      </Link>

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Delete this run?</h3>
            <p className="text-sm text-slate-500">
              This will permanently remove the run, its logs, and all artifacts. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteRun.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {deleteRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Run header card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <StatusBadge status={run.status} size="md" />
              <span className="text-sm text-slate-500">{run.flowName}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">{run.ticketKey}</h1>
            {run.title && <p className="text-slate-500">{run.title}</p>}
            <p className="font-mono text-xs text-slate-400">{run.sessionId}</p>
          </div>

          {/* Actions + Stats */}
          <div className="flex flex-col items-end gap-3">
            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {run.status === 'blocked' && (() => {
                const blockedStep = [...displaySteps].reverse().find(s => s.status === 'blocked');
                const isReviewLoop = blockedStep?.phase === 'reviewLoop';
                return isReviewLoop ? (
                  <>
                    <button
                      onClick={() => resumeRun.mutate({ sessionId: run.sessionId, ticketStatus: 'approved' })}
                      disabled={resumeRun.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {resumeRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                      Approve
                    </button>
                    <button
                      onClick={() => resumeRun.mutate({ sessionId: run.sessionId, ticketStatus: 'rejected' })}
                      disabled={resumeRun.isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-60"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => resumeRun.mutate({ sessionId: run.sessionId })}
                    disabled={resumeRun.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
                  >
                    {resumeRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                    Resume
                  </button>
                );
              })()}
              {run.status === 'running' && (
                <button
                  onClick={() => cancelRun.mutate(run.sessionId)}
                  disabled={cancelRun.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                >
                  {cancelRun.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <XCircle className="h-3.5 w-3.5" />}
                  Cancel
                </button>
              )}
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <div className="flex items-center gap-1.5">
                <Tag className="h-4 w-4 text-slate-400" />
                <span className="font-medium">{run.productId}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-slate-400" />
                <span>{completedSteps}/{totalSteps} steps</span>
              </div>
              {totalMs > 0 && (
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-slate-400" />
                  <span>{formatDuration(totalMs)}</span>
                </div>
              )}
              {run.createdAt && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {totalSteps > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Progress</span>
              <span>{Math.round((completedSteps / totalSteps) * 100)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-700"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6">
          {(['timeline', 'context', 'logs'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 pb-2 text-sm font-medium capitalize transition ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab}
              {tab === 'logs' && activeStep && (
                <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600">
                  {activeStep.id}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'timeline' && (
        <StepTimeline steps={displaySteps} onStepClick={handleStepClick} />
      )}

      {activeTab === 'context' && (
        <RunContext artifacts={run.artifacts as Record<string, unknown>} />
      )}

      {activeTab === 'logs' && activeStep && (
        <LogPanel
          lines={logs.data}
          loading={logs.isLoading}
          error={logs.error?.message}
          stepId={activeStep.id}
        />
      )}

      {activeTab === 'logs' && !activeStep && (
        <EmptyState title="No step selected" description="Click a step on the timeline to view its logs.">
          <button onClick={() => setActiveTab('timeline')} className="text-sm text-blue-600 hover:underline">
            Go to timeline
          </button>
        </EmptyState>
      )}
    </div>
  );
}
