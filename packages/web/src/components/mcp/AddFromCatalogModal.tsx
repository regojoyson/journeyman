import { useEffect, useMemo, useState } from "react";
import { btnGhost, btnPrimary, card, codePill, inputCls } from "../../routes/admin-styles.ts";
import { mcpApi, type CatalogEntry, type UpsertBody } from "../../api/mcp.ts";
import { SecretPicker } from "./SecretPicker.tsx";

export interface AddFromCatalogModalProps {
  orgId: string;
  scope: "user" | "org";
  onClose: () => void;
  onCreated: () => void;
}

export function AddFromCatalogModal(props: AddFromCatalogModalProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [chosen, setChosen] = useState<CatalogEntry | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    mcpApi.catalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of catalog) if (c.category) set.add(c.category);
    return Array.from(set).sort();
  }, [catalog]);

  const visibleCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((c) => {
      if (categoryFilter !== "all" && (c.category ?? "") !== categoryFilter) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [catalog, categoryFilter, search]);

  function pickEntry(e: CatalogEntry) {
    setChosen(e);
    setName(e.label);
    setDescription(e.description ?? "");
    const initial: Record<string, string> = {};
    for (const ev of e.requiredEnv ?? []) initial[ev] = "";
    setBindings(initial);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true); setError(null);
    const body: UpsertBody = {
      name,
      description: description || undefined,
      systemPrompt: systemPrompt || undefined,
      transport: chosen.transport,
      command: chosen.command,
      args: chosen.args,
      url: chosen.url,
      bindings: Object.entries(bindings)
        .filter(([, v]) => v)
        .map(([envVar, secretName]) => ({ envVar, secretName })),
    };
    try {
      if (props.scope === "user") await mcpApi.createMy(props.orgId, body);
      else await mcpApi.createOrg(props.orgId, body);
      props.onCreated();
      props.onClose();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">
            {chosen ? `Configure ${chosen.label}` : "Add from catalog"}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="text-slate-400 hover:text-slate-100 transition text-xl leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!chosen ? (
          <>
            <div className="mb-3 flex gap-2">
              <input
                className={`${inputCls} flex-1`}
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className={inputCls}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="all">All categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {visibleCatalog.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickEntry(c)}
                  className={`${card} p-3 text-left hover:border-indigo-500 transition`}
                >
                  <div className="text-sm font-medium text-slate-100">{c.label}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={codePill}>{c.transport}</span>
                    <span className={codePill}>{c.source}</span>
                    {c.category && <span className={codePill}>{c.category}</span>}
                  </div>
                  {c.description && (
                    <div className="mt-2 text-xs text-slate-400">{c.description}</div>
                  )}
                </button>
              ))}
              {visibleCatalog.length === 0 && (
                <div className="col-span-2 text-sm text-slate-500 text-center py-6">
                  {catalog.length === 0 ? "Catalog is empty." : "No entries match the current filter."}
                </div>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input className={inputCls} placeholder="Name" required value={name} onChange={e => setName(e.target.value)} />
            <input className={inputCls} placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
            <textarea className={inputCls} placeholder="System prompt (optional)" rows={3} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />

            <div className="text-xs text-slate-400">
              Transport <span className={codePill}>{chosen.transport}</span>
              {chosen.url && <> · URL <span className={codePill}>{chosen.url}</span></>}
              {chosen.command && <> · Command <span className={codePill}>{chosen.command}</span></>}
            </div>

            {(chosen.requiredEnv ?? []).length > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-slate-300">Required bindings</div>
                {(chosen.requiredEnv ?? []).map((ev) => (
                  <div key={ev} className="flex items-center gap-2">
                    <code className={codePill}>{ev}</code>
                    <span className="text-slate-500">→</span>
                    <SecretPicker
                      orgId={props.orgId}
                      value={bindings[ev] ?? ""}
                      onChange={(secretName) => setBindings((prev) => ({ ...prev, [ev]: secretName }))}
                      scope={props.scope === "org" ? "org-and-global" : "all"}
                      required
                    />
                  </div>
                ))}
              </div>
            )}

            {error && <div className="text-sm text-danger">{error}</div>}

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setChosen(null)} className={btnGhost}>← Back</button>
              <div className="flex gap-2">
                <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
                <button type="submit" disabled={busy} className={btnPrimary}>
                  {busy ? "Saving…" : "Add MCP"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
