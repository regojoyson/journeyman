import { useEffect, useState } from "react";

/** Split a stored newline-joined string into editable rows. Empty → one blank row. */
export function splitRows(value: string | undefined): string[] {
  if (!value) return [""];
  return value.split("\n");
}

/** Join rows back into the stored string: trim each, drop blanks, newline-separated. */
export function joinRows(rows: string[]): string {
  return rows.map(r => r.trim()).filter(r => r.length > 0).join("\n");
}

interface Props {
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  onChange: (next: string) => void;
}

export function StringListEditor({ value, readOnly, placeholder, onChange }: Props) {
  const [rows, setRows] = useState<string[]>(() => splitRows(value));

  // Re-sync rows when the committed value changes externally (e.g. selecting a
  // different node). No-op while our own rows already encode it, so mid-edit
  // blank rows are preserved.
  useEffect(() => {
    if (joinRows(rows) !== value) setRows(splitRows(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: string[]) => {
    setRows(next.length ? next : [""]);
    onChange(joinRows(next));
  };

  return (
    <div className="je-string-list">
      {rows.map((row, i) => (
        <div className="je-string-list__row" key={i}>
          <input
            className="je-string-list__input"
            value={row}
            disabled={readOnly}
            placeholder={placeholder}
            onChange={e => { const next = rows.slice(); next[i] = e.target.value; commit(next); }}
          />
          {!readOnly && (
            <button
              type="button"
              className="je-string-list__rm"
              title="Remove"
              aria-label="Remove row"
              onClick={() => commit(rows.filter((_, idx) => idx !== i))}
            >×</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="je-string-list__add" onClick={() => commit([...rows, ""])}>
          + Add
        </button>
      )}
    </div>
  );
}
