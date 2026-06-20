import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CustomAiStep } from "@journeyman/core";
import { customStepsApi } from "../../api/customSteps.ts";
import { btnDanger, btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { StatusChip } from "../StatusChip.tsx";

function CreateStepModal({
  wsId,
  onCreated,
  onCancel,
}: {
  wsId: string;
  onCreated: (step: CustomAiStep) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await customStepsApi.create(wsId, { name: name.trim() });
      onCreated(created);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h2 className="text-base font-semibold">New custom step</h2>
        <p className="text-xs text-muted-foreground">You can configure everything else after creation.</p>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Step name</label>
          <input
            autoFocus
            className={inputCls}
            placeholder="e.g. Summarize PR"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
            disabled={busy}
          />
        </div>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} disabled={busy} onClick={onCancel}>Cancel</button>
          <button className={btnPrimary} disabled={!name.trim() || busy} onClick={submit}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomStepsList(props: { wsId: string }) {
  const { wsId } = props;
  const navigate = useNavigate();
  const [items, setItems] = useState<CustomAiStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setItems(await customStepsApi.list(wsId));
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wsId]);

  const handleDelete = async (p: CustomAiStep) => {
    if (!confirm(`Delete custom step "${p.name}"?`)) return;
    await customStepsApi.remove(wsId, p.id);
    await refresh();
  };

  const handleImport = async (parsed: unknown) => {
    try {
      await customStepsApi.importOne(wsId, parsed);
      await refresh();
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes("name_conflict")) {
        const renamed = window.prompt(
          "A custom step with this name already exists. Enter a new name to import as, or Cancel.",
        );
        if (!renamed) return;
        if (typeof parsed === "object" && parsed !== null && "step" in (parsed as any)) {
          (parsed as any).step.name = renamed;
          try {
            await customStepsApi.importOne(wsId, parsed);
            await refresh();
            return;
          } catch (retryErr: any) {
            setError(retryErr?.message ?? String(retryErr));
            return;
          }
        }
      }
      setError(msg);
    }
  };

  return (
    <>
      <section className={`${card} overflow-hidden`}>
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-base font-medium text-slate-100">
            Steps
            <span className="text-slate-500 font-normal ml-2">({items.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              ref={fileInputRef}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const text = await file.text();
                  let parsed: unknown;
                  try { parsed = JSON.parse(text); }
                  catch { throw new Error("File is not valid JSON"); }
                  await handleImport(parsed);
                } catch (err: any) {
                  setError(err?.message ?? String(err));
                }
              }}
            />
            <button className={btnGhost} onClick={() => fileInputRef.current?.click()}>
              Import
            </button>
            <button className={btnPrimary} onClick={() => setShowCreate(true)}>
              + New custom step
            </button>
          </div>
        </div>

        {error && (
          <div className="px-6 py-3 text-sm text-danger border-b border-danger/25 bg-danger/10">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No custom steps yet. Create one to make it available in the flow editor.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-subtle text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-6 py-3">Name</th>
                <th className="text-left font-medium px-6 py-3">Status</th>
                <th className="text-left font-medium px-6 py-3">Output</th>
                <th className="text-left font-medium px-6 py-3">Inputs</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 border-t border-slate-700">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-surface-hover">
                  <td className="px-6 py-3">
                    <div className="text-slate-100 font-medium">{p.name}</div>
                    {p.description && (
                      <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{p.description}</div>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <StatusChip
                      tone={p.enabled ? "success" : "warning"}
                      label={p.enabled ? "Enabled" : "Draft"}
                    />
                  </td>
                  <td className="px-6 py-3 text-slate-300">
                    <span className={codePill}>{p.outputMode}</span>
                  </td>
                  <td className="px-6 py-3 text-slate-300">{p.inputFields.length}</td>
                  <td className="px-6 py-3 text-right whitespace-nowrap space-x-2">
                    <button
                      className={btnGhost}
                      onClick={async () => {
                        try {
                          await customStepsApi.exportOne(wsId, p.id);
                        } catch (err: any) {
                          setError(err?.message ?? String(err));
                        }
                      }}
                    >
                      Export
                    </button>
                    <button
                      className={btnGhost}
                      onClick={() => navigate(`/workspaces/${wsId}/custom-steps/${p.id}`)}
                    >
                      Edit
                    </button>
                    <button className={btnDanger} onClick={() => handleDelete(p)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showCreate && (
        <CreateStepModal
          wsId={wsId}
          onCreated={(created) => navigate(`/workspaces/${wsId}/custom-steps/${created.id}?section=prompt`)}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </>
  );
}
