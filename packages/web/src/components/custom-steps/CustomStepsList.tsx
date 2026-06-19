import { useEffect, useRef, useState } from "react";
import type { CustomAiStep, CustomAiStepCreateInput } from "@journeyman/core";
import { customStepsApi } from "../../api/customSteps.ts";
import { EditCustomStepModal } from "./EditCustomStepModal.tsx";
import { btnDanger, btnGhost, btnPrimary, card, codePill } from "../../routes/admin-styles.ts";

export function CustomStepsList(props: { orgId: string; scope: "user" | "org" }) {
  const { orgId, scope } = props;
  const [items, setItems] = useState<CustomAiStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ step?: CustomAiStep } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = scope === "user"
        ? await customStepsApi.listMine(orgId)
        : await customStepsApi.listOrg(orgId);
      setItems(list);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId, scope]);

  const handleSave = async (body: CustomAiStepCreateInput) => {
    if (editing?.step) {
      await customStepsApi.update(orgId, editing.step.id, scope, body);
    } else {
      await customStepsApi.createMine(orgId, body);
    }
    setEditing(null);
    await refresh();
  };

  const handleDelete = async (p: CustomAiStep) => {
    if (!confirm(`Delete custom step "${p.name}"?`)) return;
    await customStepsApi.remove(orgId, p.id, scope);
    await refresh();
  };

  const handleImport = async (parsed: unknown) => {
    try {
      await customStepsApi.importOne(orgId, parsed);
      await refresh();
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes("name_conflict")) {
        const newName = window.prompt(
          "A custom step with this name already exists. Enter a new name to import as, or Cancel.",
        );
        if (!newName) return;
        if (typeof parsed === "object" && parsed !== null && "step" in (parsed as any)) {
          (parsed as any).step.name = newName;
          try {
            await customStepsApi.importOne(orgId, parsed);
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
            {scope === "user" ? "Your steps" : "Org steps"}
            <span className="text-slate-500 font-normal ml-2">({items.length})</span>
          </h2>
          {scope === "user" && (
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
              <button className={btnPrimary} onClick={() => setEditing({})}>+ New custom step</button>
            </div>
          )}
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
                <th className="text-left font-medium px-6 py-3">Output</th>
                <th className="text-left font-medium px-6 py-3">Tools</th>
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
                  <td className="px-6 py-3 text-slate-300">
                    <span className={codePill}>{p.outputMode}</span>
                  </td>
                  <td className="px-6 py-3 text-slate-300">
                    {p.defaultTools.length === 0 ? "—" : p.defaultTools.join(", ")}
                  </td>
                  <td className="px-6 py-3 text-slate-300">{p.inputFields.length}</td>
                  <td className="px-6 py-3 text-right whitespace-nowrap space-x-2">
                    <button
                      className={btnGhost}
                      onClick={async () => {
                        try {
                          await customStepsApi.exportOne(orgId, p.id, scope);
                        } catch (err: any) {
                          setError(err?.message ?? String(err));
                        }
                      }}
                    >
                      Export
                    </button>
                    <button className={btnGhost} onClick={() => setEditing({ step: p })}>Edit</button>
                    <button className={btnDanger} onClick={() => handleDelete(p)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <EditCustomStepModal
          initial={editing.step}
          scope={scope}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
}
