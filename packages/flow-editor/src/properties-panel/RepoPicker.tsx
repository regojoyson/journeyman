// packages/flow-editor/src/properties-panel/RepoPicker.tsx
import { useEffect, useState, useCallback } from "react";
import { fetchConnectionRepos, type RepoSummary } from "../api/connections.ts";
import { useWsId } from "../state/org-context.tsx";

interface Props {
  connectionId: string;
  /** Currently selected clone URLs */
  value: string[];
  onChange: (urls: string[]) => void;
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

  const toggle = (url: string) => {
    if (readOnly) return;
    onChange(value.includes(url) ? value.filter(u => u !== url) : [...value, url]);
  };

  return (
    <div className="je-props__field">
      <label>Repositories</label>

      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {value.map(url => {
            const name = url.split("/").slice(-2).join("/").replace(/\.git$/, "");
            return (
              <span key={url} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 11, padding: "2px 7px",
                background: "rgb(var(--color-surface) / 1)",
                border: "1px solid rgb(var(--color-border) / 1)",
                borderRadius: 4,
              }}>
                {name}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => toggle(url)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}
                  >×</button>
                )}
              </span>
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
          const selected = value.includes(r.url);
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
