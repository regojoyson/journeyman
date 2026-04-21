import { useState } from 'react';
import { ChevronRight, ChevronDown, ExternalLink } from 'lucide-react';

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
  high: 'text-rose-600', medium: 'text-amber-600', low: 'text-slate-400',
};

// Pretty-print a key name
function fmtKey(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
}

// Is this value a URL?
function isUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'));
}

// ── Leaf value ────────────────────────────────────────────────────────────────

function LeafValue({ v, fieldKey }: { v: unknown; fieldKey?: string }) {
  if (v === null || v === undefined) return <span className="text-slate-300">—</span>;
  if (typeof v === 'boolean') return <span className={v ? 'text-emerald-600' : 'text-rose-500'}>{String(v)}</span>;
  if (typeof v === 'number') return <span className="text-blue-600 font-mono">{v}</span>;
  if (typeof v === 'string') {
    if (isUrl(v)) return (
      <a href={v} target="_blank" rel="noopener noreferrer"
        className="text-blue-500 hover:underline inline-flex items-center gap-0.5 break-all">
        {v.length > 60 ? v.slice(0, 60) + '…' : v}
        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
      </a>
    );
    // severity badge
    if (fieldKey === 'severity') {
      const cls = SEVERITY_COLORS[v] ?? 'text-slate-500';
      return <span className={`font-medium ${cls}`}>{v}</span>;
    }
    // sha / mono fields
    if (fieldKey === 'commitSha' || fieldKey === 'sha') {
      return <span className="font-mono text-slate-600">{(v as string).slice(0, 12)}</span>;
    }
    return <span className="text-slate-700 break-words">{v}</span>;
  }
  return <span className="text-slate-400 font-mono text-[10px]">{JSON.stringify(v)}</span>;
}

// ── Tree node (recursive) ─────────────────────────────────────────────────────

interface NodeProps {
  label: string;
  value: unknown;
  depth?: number;
  defaultOpen?: boolean;
  fieldKey?: string;
}

function TreeNode({ label, value, depth = 0, defaultOpen = false, fieldKey }: NodeProps) {
  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const [open, setOpen] = useState(defaultOpen);
  const indent = depth * 16;

  if (!isObject) {
    return (
      <div className="flex items-baseline gap-1.5 py-0.5 hover:bg-slate-50 rounded px-1 -mx-1 group"
        style={{ paddingLeft: indent + 4 }}>
        <span className="shrink-0 text-[11px] font-medium text-slate-400 min-w-[6px]">·</span>
        <span className="shrink-0 text-[11px] font-medium text-slate-500 whitespace-nowrap">{label}</span>
        <span className="text-[11px] text-slate-300 shrink-0">:</span>
        <span className="text-[11px] min-w-0"><LeafValue v={value} fieldKey={fieldKey} /></span>
      </div>
    );
  }

  type KV = { k: string; v: unknown };
  const children: KV[] = isArray
    ? (value as unknown[]).map((v, i) => ({ k: String(i), v }))
    : Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ k, v }));

  if (children.length === 0) {
    return (
      <div className="flex items-baseline gap-1.5 py-0.5" style={{ paddingLeft: indent + 4 }}>
        <span className="text-[11px] font-medium text-slate-500">{label}</span>
        <span className="text-[11px] text-slate-300">{isArray ? '[]' : '{}'}</span>
      </div>
    );
  }

  const summary = isArray
    ? <span className="text-[10px] text-slate-400 ml-1">{children.length} items</span>
    : null;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 py-0.5 w-full text-left hover:bg-slate-50 rounded px-1 -mx-1 group"
        style={{ paddingLeft: indent + 4 }}
      >
        <span className="text-slate-400 shrink-0">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">{label}</span>
        {summary}
      </button>
      {open && (
        <div>
          {children.map(({ k, v }) => (
            <TreeNode
              key={k}
              label={isArray ? `#${parseInt(k) + 1}` : fmtKey(k)}
              value={v}
              depth={depth + 1}
              fieldKey={k}
              defaultOpen={depth < 1 && !isArray && children.length <= 6}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root section per top-level artifact key ───────────────────────────────────

function ArtifactSection({ artifactKey, value }: { artifactKey: string; value: unknown }) {
  const [open, setOpen] = useState(artifactKey === 'ticket' || artifactKey === 'pr' || artifactKey === 'commit');
  type KV2 = { k: string; v: unknown };
  const isObj = value !== null && typeof value === 'object';
  const children: KV2[] = isObj
    ? (Array.isArray(value)
        ? (value as unknown[]).map((v, i) => ({ k: String(i), v }))
        : Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ k, v })))
    : [];

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-2 text-left hover:bg-slate-50 transition"
      >
        <span className="text-slate-400 shrink-0">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="text-xs font-semibold text-slate-700">{fmtKey(artifactKey)}</span>
        {isObj && (
          <span className="text-[10px] text-slate-300 ml-auto">
            {Array.isArray(value) ? `[${(value as unknown[]).length}]` : `{${children.length}}`}
          </span>
        )}
      </button>

      {open && isObj && (
        <div className="px-4 pb-2">
          {children.map(({ k, v }) => (
            <TreeNode
              key={k}
              label={Array.isArray(value) ? `#${parseInt(k) + 1}` : fmtKey(k)}
              value={v}
              depth={0}
              fieldKey={k}
              defaultOpen={!Array.isArray(value) && children.length <= 8}
            />
          ))}
        </div>
      )}

      {open && !isObj && (
        <div className="px-4 pb-2">
          <span className="text-xs text-slate-600 break-all"><LeafValue v={value} /></span>
        </div>
      )}
    </div>
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
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100">
      {entries.map(([k, v]) => (
        <ArtifactSection key={k} artifactKey={k} value={v} />
      ))}
    </div>
  );
}
