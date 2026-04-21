import { ExternalLink, AlertTriangle, ListChecks, FileCode2, GitBranch, Ticket, Info, Hash } from 'lucide-react';

interface RunContextProps {
  artifacts: Record<string, unknown>;
}

const HIDDEN_KEYS = new Set(['repoPaths', 'ticketMd', '__resumeStatus', '__resumed']);

const KEY_ORDER: Record<string, number> = {
  ticket: 1, analysis: 2, plan: 3, implementation: 4,
  commit: 5, pr: 6, repoRefs: 7, checkoutResults: 8,
  statusHistory: 9, primaryRepoPath: 10,
};

const SEVERITY_COLORS: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function Row({ icon, label, value, href }: { icon?: React.ReactNode; label: string; value: string; href?: string }) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
      {icon && <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>}
      <span className="shrink-0 w-32 text-xs font-medium text-slate-500">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline flex items-center gap-1 break-all min-w-0">
          {value.length > 60 ? value.slice(0, 60) + '…' : value}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      ) : (
        <span className="text-xs text-slate-700 break-words min-w-0">{value}</span>
      )}
    </div>
  );
}

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ── Per-artifact renderers ────────────────────────────────────────────────────

function TicketCard({ value }: { value: any }) {
  return (
    <CardShell title="Ticket">
      <Row icon={<Ticket className="h-3.5 w-3.5" />} label="Title" value={value.title ?? '—'} />
      <Row icon={<Info className="h-3.5 w-3.5" />} label="Status" value={value.status ?? '—'} />
      {value.url && <Row icon={<ExternalLink className="h-3.5 w-3.5" />} label="URL" value={value.url} href={value.url} />}
      {value.body && (
        <p className="mt-2 text-xs text-slate-600 leading-relaxed line-clamp-4">{value.body}</p>
      )}
    </CardShell>
  );
}

function AnalysisCard({ value }: { value: any }) {
  const findings: any[] = value.findings ?? [];
  return (
    <CardShell title="Analysis">
      {value.ticketSummary && (
        <p className="mb-3 text-sm text-slate-600 leading-relaxed">{value.ticketSummary}</p>
      )}
      {findings.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{findings.length} Findings</p>
          {findings.map((f: any) => (
            <div key={f.id} className={`rounded-lg border px-3 py-2.5 ${SEVERITY_COLORS[f.severity] ?? SEVERITY_COLORS.low}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="text-xs font-medium">{f.title}</span>
                {f.severity && (
                  <span className="ml-auto text-[10px] font-semibold uppercase">{f.severity}</span>
                )}
              </div>
              {f.recommendation && (
                <p className="mt-1 text-[11px] leading-relaxed opacity-80">{f.recommendation}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function PlanCard({ value }: { value: any }) {
  const tasks: any[] = value.tasks ?? value.steps ?? value.items ?? [];
  return (
    <CardShell title="Plan">
      {value.summary && <p className="mb-3 text-sm text-slate-600 leading-relaxed">{value.summary}</p>}
      {tasks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tasks.length} Tasks</p>
          {tasks.map((t: any, i: number) => (
            <div key={i} className="flex items-start gap-2.5 rounded-md bg-slate-50 px-3 py-2">
              <ListChecks className="h-3.5 w-3.5 mt-0.5 shrink-0 text-blue-400" />
              <span className="text-xs text-slate-700">
                <span className="font-medium text-slate-400 mr-1">{i + 1}.</span>
                {typeof t === 'string' ? t : (t.title ?? t.name ?? t.description ?? JSON.stringify(t))}
              </span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function ImplementationCard({ value }: { value: any }) {
  const files: string[] = value.filesModified ?? value.files ?? value.changedFiles ?? [];
  return (
    <CardShell title="Implementation">
      {value.summary && <p className="mb-3 text-sm text-slate-600 leading-relaxed">{value.summary}</p>}
      {files.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{files.length} Files changed</p>
          {files.map((f: string, i: number) => (
            <div key={i} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5">
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="font-mono text-xs text-slate-700 break-all">{f}</span>
            </div>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function CommitCard({ value }: { value: any }) {
  const commits: any[] = value.commits ?? (Array.isArray(value) ? value : [value]);
  return (
    <CardShell title="Commit">
      {commits.map((c: any, i: number) => (
        <div key={i} className={commits.length > 1 ? 'pb-3 mb-3 border-b border-slate-100 last:border-0 last:mb-0 last:pb-0' : ''}>
          {c.sha && <Row icon={<Hash className="h-3.5 w-3.5" />} label="SHA" value={String(c.sha).slice(0, 12)} />}
          {c.branch && <Row icon={<GitBranch className="h-3.5 w-3.5" />} label="Branch" value={c.branch} />}
          {c.message && <Row icon={<Info className="h-3.5 w-3.5" />} label="Message" value={c.message} />}
        </div>
      ))}
    </CardShell>
  );
}

function PrCard({ value }: { value: any }) {
  const url: string | undefined = value.url ?? value.prUrl ?? value.htmlUrl;
  const title: string | undefined = value.title ?? value.prTitle;
  const number: string | undefined = value.number != null ? `#${value.number}` : undefined;
  return (
    <CardShell title="Pull Request">
      {title && <Row icon={<Info className="h-3.5 w-3.5" />} label="Title" value={title} />}
      {number && <Row icon={<Hash className="h-3.5 w-3.5" />} label="Number" value={number} />}
      {url && <Row icon={<ExternalLink className="h-3.5 w-3.5" />} label="URL" value={url} href={url} />}
    </CardShell>
  );
}

function GenericCard({ title, value }: { title: string; value: unknown }) {
  return (
    <CardShell title={title.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()}>
      <pre className="whitespace-pre-wrap break-words text-[11px] font-mono text-slate-500 max-h-48 overflow-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </CardShell>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function RunContext({ artifacts }: RunContextProps) {
  const entries = Object.entries(artifacts)
    .filter(([k]) => !HIDDEN_KEYS.has(k))
    .sort(([a], [b]) => (KEY_ORDER[a] ?? 99) - (KEY_ORDER[b] ?? 99));

  if (entries.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-slate-400">
        No artifacts yet — context will appear as steps complete.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map(([k, v]) => {
        if (!v) return null;
        switch (k) {
          case 'ticket':        return <TicketCard key={k} value={v} />;
          case 'analysis':      return <AnalysisCard key={k} value={v} />;
          case 'plan':          return <PlanCard key={k} value={v} />;
          case 'implementation':return <ImplementationCard key={k} value={v} />;
          case 'commit':        return <CommitCard key={k} value={v} />;
          case 'pr':            return <PrCard key={k} value={v} />;
          default:              return <GenericCard key={k} title={k} value={v} />;
        }
      })}
    </div>
  );
}
