import { useState } from "react";

interface ListensForPickerProps {
  value: string[];
  knownEventTypes: string[];
  webhookPicked: boolean;
  readOnly?: boolean;
  onChange: (next: string[]) => void;
}

export function ListensForPicker({
  value,
  knownEventTypes,
  webhookPicked,
  readOnly,
  onChange,
}: ListensForPickerProps) {
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  // null = dropdown mode; string (incl. "") = custom-input mode

  const remaining = knownEventTypes.filter((t) => !value.includes(t));
  const isCustomMode = customDraft !== null;

  function add(eventType: string) {
    const trimmed = eventType.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  }

  function remove(eventType: string) {
    onChange(value.filter((t) => t !== eventType));
  }

  function onDropdownChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const picked = e.target.value;
    if (!picked) return;
    if (picked === "__custom__") {
      setCustomDraft("");
      return;
    }
    add(picked);
    e.target.value = "";
  }

  function commitCustom() {
    if (customDraft === null) return;
    add(customDraft);
    setCustomDraft(null);
  }

  function cancelCustom() {
    setCustomDraft(null);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 8px",
          minHeight: 32,
          border: "1px solid var(--je-border, #2a2f3a)",
          borderRadius: 4,
          background: "var(--je-input-bg, #1a1d24)",
        }}
      >
        {value.length === 0 ? (
          <span style={{ color: "#777", fontSize: 12, fontStyle: "italic" }}>
            (no filters — accepts any event type)
          </span>
        ) : (
          value.map((t) => (
            <span
              key={t}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                background: "#4a9eff22",
                color: "#9cc7ff",
                borderRadius: 3,
                fontSize: 12,
                fontFamily: "monospace",
              }}
            >
              {t}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label={`Remove ${t}`}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#9cc7ff",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {!readOnly && (
        <div style={{ marginTop: 6 }}>
          {isCustomMode ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                autoFocus
                type="text"
                placeholder="custom event type"
                value={customDraft ?? ""}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCustom();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCustom();
                  }
                }}
                style={{ flex: 1 }}
              />
              <button type="button" onClick={commitCustom} aria-label="Add custom event type">
                ✓
              </button>
              <button type="button" onClick={cancelCustom} aria-label="Cancel">
                ×
              </button>
            </div>
          ) : (
            <select
              value=""
              disabled={!webhookPicked}
              onChange={onDropdownChange}
            >
              <option value="">
                {webhookPicked ? "+ Add event type" : "Pick a webhook above first"}
              </option>
              {remaining.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="__custom__">✏  Custom event type…</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}
