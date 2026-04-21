import { useParams, Link, useNavigate } from 'react-router-dom';
import { useRunDetail, useCancelRun, useDeleteRun, useResumeRun, useRetryRun } from '@/api/runs';
import type { RunStep } from '@/types/api.types';
import StepTimeline from './StepTimeline';
import RunContext from './RunContext';
import EmptyState from '@/components/shared/EmptyState';
import StatusBadge from '@/components/shared/StatusBadge';
import { ArrowLeft, Loader2, Clock, Tag, Calendar, XCircle, Trash2, PlayCircle, RotateCcw, Hash, Workflow } from 'lucide-react';
import { useState } from 'react';
import { formatDuration } from '@/utils/format';

export default function RunDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { data: run, isLoading, error } = useRunDetail(sessionId!);
  const [activeTab, setActiveTab] = useState<'timeline' | 'context'>('timeline');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resumeDialog, setResumeDialog] = useState<{ defaultStatus: string } | null>(null);
  const [ticketStatusInput, setTicketStatusInput] = useState('');

  const cancelRun = useCancelRun();
  const deleteRun = useDeleteRun();
  const resumeRun = useResumeRun();
  const retryRun = useRetryRun();

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

  async function handleDelete() {
    await deleteRun.mutateAsync({ sessionId: sessionId! });
    navigate('/');
  }

  function openResumeDialog(defaultStatus: string) {
    setTicketStatusInput(defaultStatus);
    setResumeDialog({ defaultStatus });
  }

  async function handleResume() {
    await resumeRun.mutateAsync({ sessionId: sessionId!, ticketStatus: ticketStatusInput });
    setResumeDialog(null);
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to runs
      </Link>

      {/* Resume with status dialog */}
      {resumeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Resume run</h3>
              <p className="mt-1 text-sm text-slate-500">
                Enter the ticket status to resume with. The pipeline will continue from the blocked step using this status.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-600">Ticket status</label>
              <input
                type="text"
                value={ticketStatusInput}
                onChange={e => setTicketStatusInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !resumeRun.isPending && handleResume()}
                placeholder="e.g. approved"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Quick pick:</span>
                {['approved', 'rejected', 'rework-requested', 'completed'].map(hint => (
                  <button
                    key={hint}
                    onClick={() => setTicketStatusInput(hint)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                      ticketStatusInput === hint
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {hint}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Use <span className="font-mono">approved</span> / <span className="font-mono">completed</span> to mark as done, <span className="font-mono">rejected</span> / <span className="font-mono">rework-requested</span> to send back for changes.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setResumeDialog(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={handleResume}
                disabled={resumeRun.isPending || !ticketStatusInput.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {resumeRun.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Resume
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Run header */}
      <div className="rounded-lg border border-slate-200 bg-white">
        {/* Top row: title + actions */}
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={run.status} size="md" />
              {run.title && <span className="text-sm text-slate-600 truncate">{run.title}</span>}
            </div>
            <h1 className="text-xl font-semibold text-slate-900 leading-tight">{run.ticketKey}</h1>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {run.status === 'blocked' && (() => {
              const blockedStep = [...displaySteps].reverse().find(s => s.status === 'blocked');
              const isReviewLoop = blockedStep?.phase === 'reviewLoop';
              return isReviewLoop ? (
                <button
                  onClick={() => openResumeDialog('')}
                  disabled={resumeRun.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {resumeRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                  Set Status & Resume
                </button>
              ) : (
                <button
                  onClick={() => openResumeDialog('')}
                  disabled={resumeRun.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  {resumeRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                  Resume
                </button>
              );
            })()}
            {run.status === 'failed' && (
              <button
                onClick={() => retryRun.mutate(run.sessionId)}
                disabled={retryRun.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-60"
              >
                {retryRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Retry
              </button>
            )}
            {run.status === 'running' && (
              <button
                onClick={() => cancelRun.mutate(run.sessionId)}
                disabled={cancelRun.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {cancelRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Cancel
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-50 hover:border-rose-200"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>

        {retryRun.isError && (
          <p className="px-5 pb-2 text-xs text-rose-500">{(retryRun.error as Error)?.message ?? 'Retry failed'}</p>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 px-5 py-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Product</p>
            <div className="flex items-center gap-1 text-sm font-medium text-slate-700">
              <Tag className="h-3.5 w-3.5 text-slate-400" />{run.productId}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Flow</p>
            <div className="flex items-center gap-1 text-sm text-slate-700">
              <Workflow className="h-3.5 w-3.5 text-slate-400" />{run.flowName}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Progress</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: totalSteps > 0 ? `${(completedSteps / totalSteps) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-sm text-slate-700 flex-shrink-0">{completedSteps}/{totalSteps}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Duration</p>
            <div className="flex items-center gap-1 text-sm text-slate-700">
              <Clock className="h-3.5 w-3.5 text-slate-400" />{totalMs > 0 ? formatDuration(totalMs) : '—'}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Started</p>
            <div className="flex items-center gap-1 text-sm text-slate-700">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              {run.createdAt ? new Date(run.createdAt).toLocaleString() : '—'}
            </div>
          </div>
          {run.updatedAt && (
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Last updated</p>
              <div className="flex items-center gap-1 text-sm text-slate-700">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                {new Date(run.updatedAt).toLocaleString()}
              </div>
            </div>
          )}
          <div className="col-span-2">
            <p className="text-xs text-slate-400 mb-0.5">Session ID</p>
            <div className="flex items-center gap-1 text-xs font-mono text-slate-500">
              <Hash className="h-3 w-3 text-slate-400" />{run.sessionId}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6">
          {(['timeline', 'context'] as const).map(tab => (
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
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'timeline' && (
        <StepTimeline steps={displaySteps} sessionId={sessionId!} />
      )}

      {activeTab === 'context' && (
        <RunContext artifacts={run.artifacts as Record<string, unknown>} />
      )}
    </div>
  );
}
