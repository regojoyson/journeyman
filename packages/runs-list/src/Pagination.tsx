import React from "react";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination(p: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize));
  const page = Math.min(p.page, totalPages);
  const start = p.total === 0 ? 0 : (page - 1) * p.pageSize + 1;
  const end = Math.min(p.total, page * p.pageSize);
  const opts = p.pageSizeOptions ?? [10, 25, 50, 100];

  const btnStyle: React.CSSProperties = {
    background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#ccc",
    padding: "4px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer",
    fontFamily: "inherit",
  };
  const disabledStyle: React.CSSProperties = { ...btnStyle, opacity: 0.4, cursor: "default" };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 4px", color: "#888", fontSize: 12, gap: 12, flexWrap: "wrap",
    }}>
      <div>
        {p.total === 0 ? "0 results" : `${start}–${end} of ${p.total}`}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          style={page <= 1 ? disabledStyle : btnStyle}
          disabled={page <= 1}
          onClick={() => p.onPageChange(page - 1)}
        >‹ Prev</button>
        <span style={{ color: "#aaa" }}>Page {page} of {totalPages}</span>
        <button
          type="button"
          style={page >= totalPages ? disabledStyle : btnStyle}
          disabled={page >= totalPages}
          onClick={() => p.onPageChange(page + 1)}
        >Next ›</button>
        {p.onPageSizeChange && (
          <label style={{ marginLeft: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span>Page size</span>
            <select
              value={p.pageSize}
              onChange={e => p.onPageSizeChange!(Number(e.target.value))}
              style={{ background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "3px 6px", borderRadius: 4, fontSize: 12, fontFamily: "inherit" }}
            >
              {opts.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
