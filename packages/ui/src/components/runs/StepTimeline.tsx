import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, Loader2, PauseCircle, MinusCircle,
  Circle, ChevronDown, ChevronRight, Clock, Hash,
  AlertTriangle, Info, Ticket, GitBranch, FileCode2,
  ListChecks, ExternalLink, FolderGit2,
} from 'lucide-react';
import { RunStep, StepStatus } from '@/types/api.types';
import { formatStepName, formatDuration } from '@/utils/format';

interface StepTimelineProps {
  steps: RunStep[];
  onStepClick?: (step: RunStep) => void;
}

type StepCfg = { icon: React.ReactNode; pill: string; bar: string; label: string };

function getStepCfg(status: StepStatus): StepCfg {
  switch (status) {
    case 'ok':
      return { icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', label: 'Completed' };
    case 'running':
      return { icon: <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />, pill: 'bg-blue-50 text-blue-700 border-blue-200', bar: 'bg-blue-500', label: 'Running' };
    case 'failed':
      return { icon: <XCircle className="h-5 w-5 text-rose-500" />, pill: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-500', label: 'Failed' };
    case 'blocked':
      return { icon: <PauseCircle className="h-5 w-5 text-amber-500" />, pill: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500', label: 'Blocked' };
    case 'skipped':
    case 'cancelled':
      return { icon: <MinusCircle className="h-5 w-5 text-slate-400" />, pill: 'bg-slate-50 text-slate-500 border-slate-200', bar: 'bg-slate-300', label: status === 'skipped' ? 'Skipped' : 'Cancelled' };
    default:
      return { icon: <Circle className="h-5 w-5 text-slate-300" />, pill: 'bg-slate-50 text-slate-400 border-slate-200', bar: 'bg-slate-200', label: 'Pending' };
  }
}

// ── Phase-specific output renderers ──────────────────────────────────────────

function SubstepRow({ icon, label, value, mono = false, href }: {
  icon: React.ReactNode; label: string; value: string; mono?: boolean; href?: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <span className="shrink-0 w-28 text-xs text-slate-500">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline flex items-center gap-1 break-all">
          {value} <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ) : (
        <span className={`text-xs break-all ${mono ? 'font-mono text-slate-700' : 'text-slate-700'}`}>{value}</span>
      )}
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  high:   'bg-rose-100 text-rose-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-slate-100 text-slate-600',
};

function PhaseOutput({ phase, output }: { phase: string; output: Record<string, unknown> }) {
  switch (phase) {
    case 'getTicket': {
      const t = output.ticket as any;
      if (!t) break;
      return (
        <div className="space-y-0">
          <SubstepRow icon={<Ticket className="h-3.5 w-3.5" />} label="Title" value={t.title ?? '—'} />
          <SubstepRow icon={<Info className="h-3.5 w-3.5" />} label="Status" value={t.status ?? '—'} />
          {t.url && <SubstepRow icon={<ExternalLink className="h-3.5 w-3.5" />} label="Issue URL" value={t.url} href={t.url} />}
        </div>
      );
    }

    case 'cloneRepos': {
      const refs = output.repoRefs as any[];
      if (!refs?.length) break;
      return (
        <div className="space-y-0">
          {refs.map((r: any, i: number) => (
            <SubstepRow key={i} icon={<FolderGit2 className="h-3.5 w-3.5" />} label="Repo" value={`${r.owner}/${r.repo}`} mono />
          ))}
        </div>
      );
    }

    case 'checkoutRepo': {
      const results = output.checkoutResults as any[];
      if (!results?.length) break;
      return (
        <div className="space-y-0">
          {results.map((r: any, i: number) => (
            <div key={i}>
              <SubstepRow icon={<GitBranch className="h-3.5 w-3.5" />} label="Base branch" value={r.baseBranch ?? '—'} mono />
              <SubstepRow icon={<GitBranch className="h-3.5 w-3.5" />} label="New branch" value={r.newBranch ?? '—'} mono />
            </div>
          ))}
        </div>
      );
    }

    case 'analyze': {
      const analysis = output.analysis as any;
      if (!analysis) break;
      const findings: any[] = analysis.findings ?? [];
      return (
        <div className="space-y-2">
          {analysis.ticketSummary && (
            <p className="text-xs text-slate-600 leading-relaxed">{analysis.ticketSummary}</p>
          )}
          {findings.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {findings.length} Findings
              </div>
              <div className="space-y-1.5">
                {findings.map((f: any) => (
                  <div key={f.id} className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-slate-700">{f.title}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.low}`}>
                          {f.severity}
                        </span>
                      </div>
                      {f.recommendation && (
                        <p className="mt-0.5 text-[11px] text-slate-500">{f.recommendation}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    case 'plan': {
      const plan = output.plan as any;
      if (!plan) break;
      const tasks: any[] = plan.tasks ?? plan.steps ?? plan.items ?? [];
      return (
        <div className="space-y-2">
          {plan.summary && <p className="text-xs text-slate-600 leading-relaxed">{plan.summary}</p>}
          {tasks.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {tasks.length} Tasks
              </div>
              <div className="space-y-1">
                {tasks.map((t: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2">
                    <ListChecks className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-400" />
                    <div className="text-xs text-slate-700">
                      <span className="font-medium text-slate-500 mr-1">{i + 1}.</span>
                      {typeof t === 'string' ? t : (t.title ?? t.name ?? t.description ?? JSON.stringify(t))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    case 'implement': {
      const impl = output.implementation as any ?? output as any;
      const files: string[] = impl.filesModified ?? impl.files ?? impl.changedFiles ?? [];
      return (
        <div className="space-y-1">
          {files.length > 0 ? (
            <>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {files.length} Files
              </div>
              {files.map((f: string, i: number) => (
                <div key={i} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5">
                  <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="font-mono text-xs text-slate-700 break-all">{f}</span>
                </div>
              ))}
            </>
          ) : (
            <RawOutput output={output} />
          )}
        </div>
      );
    }

    case 'commitPushRepos': {
      const o = output as any;
      const commits: any[] = o.commits ?? [];
      const pr: string | undefined = o.prUrl ?? o.pullRequestUrl;
      return (
        <div className="space-y-0">
          {commits.map((c: any, i: number) => (
            <div key={i}>
              {c.sha && <SubstepRow icon={<GitBranch className="h-3.5 w-3.5" />} label="Commit" value={String(c.sha).slice(0, 8)} mono />}
              {c.branch && <SubstepRow icon={<GitBranch className="h-3.5 w-3.5" />} label="Branch" value={c.branch} mono />}
              {c.message && <SubstepRow icon={<Info className="h-3.5 w-3.5" />} label="Message" value={c.message} />}
            </div>
          ))}
          {pr && <SubstepRow icon={<ExternalLink className="h-3.5 w-3.5" />} label="PR URL" value={String(pr)} href={String(pr)} />}
          {commits.length === 0 && !pr && <RawOutput output={output} />}
        </div>
      );
    }

    case 'createPR': {
      const o = output as any;
      const url: string | undefined = o.url ?? o.prUrl ?? o.pullRequestUrl ?? o.htmlUrl;
      const title: string | undefined = o.title ?? o.prTitle;
      const number: string | undefined = o.number != null ? String(o.number) : undefined;
      return (
        <div className="space-y-0">
          {title && <SubstepRow icon={<Info className="h-3.5 w-3.5" />} label="Title" value={title} />}
          {number && <SubstepRow icon={<Hash className="h-3.5 w-3.5" />} label="PR #" value={number} mono />}
          {url && <SubstepRow icon={<ExternalLink className="h-3.5 w-3.5" />} label="URL" value={url} href={url} />}
          {!title && !url && <RawOutput output={output} />}
        </div>
      );
    }

    default:
      break;
  }
  return <RawOutput output={output} />;
}

function RawOutput({ output }: { output: Record<string, unknown> }) {
  return (
    <pre className="whitespace-pre-wrap break-words text-[11px] font-mono text-slate-300 max-h-56 overflow-auto">
      {JSON.stringify(output, null, 2)}
    </pre>
  );
}

// ── StepRow ───────────────────────────────────────────────────────────────────

function StepRow({ step, index, total, onStepClick }: {
  step: RunStep; index: number; total: number; onStepClick?: (s: RunStep) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getStepCfg(step.status);
  const isLast = index === total - 1;
  const hasOutput = step.output && Object.keys(step.output).length > 0;

  function toggle() {
    setExpanded(e => !e);
    if (!expanded && onStepClick) onStepClick(step);
  }

  return (
    <div className="relative flex gap-4">
      {/* Connector column */}
      <div className="flex flex-col items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white ring-2 ring-slate-100 z-10">
          {cfg.icon}
        </div>
        {!isLast && <div className={`mt-1 w-0.5 flex-1 min-h-[24px] ${cfg.bar} opacity-30`} />}
      </div>

      {/* Card */}
      <div className="flex-1 pb-4">
        <button
          onClick={toggle}
          className="w-full text-left rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-slate-300 hover:shadow transition"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-slate-800 truncate">{formatStepName(step.id)}</span>
              <span className={`hidden sm:inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.pill}`}>
                {cfg.label}
              </span>
              <span className="hidden md:inline text-xs text-slate-400 font-mono">{step.phase}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-xs text-slate-400">
              {step.durationMs != null && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(step.durationMs)}
                </span>
              )}
              {step.attempt > 1 && (
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  attempt {step.attempt}
                </span>
              )}
              {hasOutput && (expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
            </div>
          </div>

          {step.startedAt && (
            <div className="mt-1.5 flex gap-4 text-[11px] text-slate-400 font-mono">
              <span>Started {new Date(step.startedAt).toLocaleTimeString()}</span>
              {step.endedAt && <span>→ {new Date(step.endedAt).toLocaleTimeString()}</span>}
            </div>
          )}

          {step.error && (
            <div className="mt-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700 font-mono space-y-0.5">
              {typeof step.error === 'string' ? (
                <span>{step.error}</span>
              ) : (
                Object.entries(step.error as Record<string, unknown>).map(([k, v]) => (
                  <div key={k}>
                    <span className="font-semibold">{k}: </span>
                    <span>{String(v ?? '—')}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </button>

        {/* Substep output panel */}
        <AnimatePresence>
          {expanded && hasOutput && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="mt-1 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Step Output
                </div>
                <PhaseOutput phase={step.phase} output={step.output!} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StepTimeline({ steps, onStepClick }: StepTimelineProps) {
  const completed = steps.filter(s => s.status === 'ok').length;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between text-sm text-slate-500">
        <span>{steps.length} steps</span>
        <span className="text-emerald-600 font-medium">{completed} / {steps.length} completed</span>
      </div>
      {steps.map((step, i) => (
        <StepRow key={step.id} step={step} index={i} total={steps.length} onStepClick={onStepClick} />
      ))}
    </div>
  );
}
