// packages/flow-editor/src/properties-panel/RepoPicker.tsx
import { useEffect, useState, useCallback } from "react";
import { fetchConnectionRepos, type RepoSummary } from "../api/connections.ts";
import { useWsId } from "../state/org-context.tsx";

export interface RepoSelection {
  url: string;
  branch?: string;
}

interface Props {
  connectionId: string;
  /** Currently selected repos with their per-repo checkout branch */
  value: RepoSelection[];
  onChange: (repos: RepoSelection[]) => void;
  readOnly?: boolean;
}

export function RepoPicker({ connectionId, value, onChange, readOnly }: Props) {
  const wsId = useWsId();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (q: string) => {
      if (!wsId) return;
      setLoading(true);
      fetchConnectionRepos(wsId, connectionId, q || undefined)
        .then(setRepos)
        .catch(() => setRepos([]))
        .finally(() => setLoading(false));
    },
    [wsId, connectionId],
  );

  useEffect(() => { load(""); }, [load]);

  useEffect(() => {
    const id = window.setTimeout(() => load(search), 300);
    return () => window.clearTimeout(id);
  }, [search, load]);

  const isSelected = (url: string) => value.some(r => r.url === url);

  const toggle = (url: string) => {
    if (readOnly) return;
    onChange(isSelected(url) ? value.filter(r => r.url !== url) : [...value, { url }]);
  };

  const setBranch = (url: string, branch: string) => {
    if (readOnly) return;
    onChange(value.map(r => (r.url === url ? { ...r, branch: branch || undefined } : r)));
  };

  return (
    <div className="je-props__field">
      <label>Repositories</label>

      {value.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {value.map(r => {
            const name = r.url.split("/").slice(-2).join("/").replace(/\.git$/, "");
            return (
              <div key={r.url} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, padding: "3px 7px",
                background: "rgb(var(--color-surface) / 1)",
                border: "1px solid rgb(var(--color-border) / 1)",
                borderRadius: 4,
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                <input
                  type="text"
                  placeholder="default branch"
                  value={r.branch ?? ""}
                  onChange={e => setBranch(r.url, e.target.value)}
                  disabled={readOnly}
                  style={{ width: 130, fontSize: 11, padding: "1px 5px", boxSizing: "border-box" }}
                />
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => toggle(r.url)}
                    aria-label={`Remove ${name}`}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <input
        type="search"
        placeholder="Search repos…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        disabled={readOnly}
        style={{ width: "100%", marginBottom: 4, boxSizing: "border-box" }}
      />

      <div style={{
        maxHeight: 150, overflowY: "auto",
        border: "1px solid rgb(var(--color-border) / 1)", borderRadius: 4,
      }}>
        {loading && (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "rgb(var(--color-text-muted) / 1)" }}>
            Loading…
          </div>
        )}
        {!loading && repos.length === 0 && (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "rgb(var(--color-text-muted) / 1)" }}>
            No repos found.
          </div>
        )}
        {repos.map(r => {
          const selected = isSelected(r.url);
          return (
            <div
              key={r.url}
              onClick={() => toggle(r.url)}
              style={{
                padding: "5px 8px", fontSize: 12, cursor: readOnly ? "default" : "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: selected ? "rgb(var(--color-info) / 0.1)" : undefined,
              }}
            >
              <span>{r.fullName}</span>
              {selected && <span style={{ fontSize: 11, color: "rgb(var(--color-info) / 1)" }}>✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
