import { useState, useMemo } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';
import { useCreateRun, useFlows, useRuns } from '@/api/runs';

interface CreateRunDialogProps {
  open: boolean;
  onClose: () => void;
  defaultProductId?: string;
}

export default function CreateRunDialog({ open, onClose, defaultProductId }: CreateRunDialogProps) {
  const { data: flows = [] } = useFlows();
  const { data: runsData } = useRuns({ limit: 200 }, 60);
  const products = useMemo(() => {
    const ids = new Set((runsData?.runs ?? []).map(r => r.productId));
    return [...ids].sort();
  }, [runsData]);
  const createRun = useCreateRun();

  const [productId, setProductId] = useState(defaultProductId ?? '');
  const [ticketKey, setTicketKey] = useState('');
  const [ticketShortKey, setTicketShortKey] = useState('');
  const [flowName, setFlowName] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  function reset() {
    setProductId(defaultProductId ?? '');
    setTicketKey('');
    setTicketShortKey('');
    setFlowName('');
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createRun.mutateAsync({
        productId: productId.trim(),
        ticketKey: ticketKey.trim(),
        ticketShortKey: ticketShortKey.trim() || undefined,
        flowName: flowName || undefined,
      });
      handleClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create run');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">New Pipeline Run</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <Field label="Product ID" required>
            {products.length > 0 ? (
              <select
                value={productId}
                onChange={e => setProductId(e.target.value)}
                required
                className="input"
              >
                <option value="">Select a product…</option>
                {products.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={productId}
                onChange={e => setProductId(e.target.value)}
                placeholder="e.g. sam-portfolio"
                required
                className="input"
              />
            )}
          </Field>

          <Field label="Ticket Key" required>
            <input
              type="text"
              value={ticketKey}
              onChange={e => setTicketKey(e.target.value)}
              placeholder="e.g. owner/repo#42 or PROJ-123"
              required
              className="input"
            />
          </Field>

          <Field label="Ticket Short Key" hint="Optional — derived automatically if omitted">
            <input
              type="text"
              value={ticketShortKey}
              onChange={e => setTicketShortKey(e.target.value)}
              placeholder="e.g. 42"
              className="input"
            />
          </Field>

          <Field label="Flow">
            <select
              value={flowName}
              onChange={e => setFlowName(e.target.value)}
              className="input"
            >
              <option value="">Default flow</option>
              {flows.map(f => (
                <option key={f.name} value={f.name}>{f.name}</option>
              ))}
            </select>
          </Field>

          {error && (
            <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700 font-mono">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={handleClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createRun.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {createRun.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
                : <><Plus className="h-4 w-4" /> Create Run</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-slate-700">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
