import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  multiline?: boolean;
  onSave: (next: string | null) => Promise<void>;
  placeholder?: string;
  allowEmpty?: boolean;
  displayClassName?: string;
  ariaLabel?: string;
}

export function InlineEdit({
  value,
  multiline = false,
  onSave,
  placeholder = "Click to edit",
  allowEmpty = false,
  displayClassName = "",
  ariaLabel,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  function start() {
    setError(null);
    setDraft(value);
    setEditing(true);
  }

  function cancel() {
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed && !allowEmpty) {
      setError("Required");
      return;
    }
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed ? trimmed : null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDraft(value);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      void commit();
    } else if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  if (editing) {
    const commonClass =
      "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-slate-100 disabled:opacity-50";
    return (
      <div className="space-y-1">
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            rows={3}
            value={draft}
            disabled={busy}
            aria-label={ariaLabel}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={onKeyDown}
            className={commonClass}
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={draft}
            disabled={busy}
            aria-label={ariaLabel}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={onKeyDown}
            className={commonClass}
          />
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {multiline && !error && (
          <p className="text-xs text-slate-500">Press ⌘/Ctrl+Enter to save, Esc to cancel.</p>
        )}
      </div>
    );
  }

  const isEmpty = !value || !value.trim();
  return (
    <button
      type="button"
      onClick={start}
      className={`group inline-flex items-start gap-2 text-left hover:bg-slate-800/40 rounded px-1 -mx-1 ${displayClassName}`}
      aria-label={ariaLabel ? `Edit ${ariaLabel}` : "Edit"}
    >
      <span className={isEmpty ? "text-slate-500 italic" : ""}>
        {isEmpty ? placeholder : value}
      </span>
      <span aria-hidden className="opacity-0 group-hover:opacity-60 text-xs text-slate-400 mt-1.5">
        ✎
      </span>
    </button>
  );
}
