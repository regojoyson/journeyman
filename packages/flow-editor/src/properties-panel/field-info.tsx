import { useId, useState } from "react";

export function FieldInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <span className="je-icon-btn-wrap" style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="je-field-info-btn"
        aria-label="More information"
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => e.key === "Escape" && setOpen(false)}
      >
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5.5" stroke="currentColor"/>
          <path d="M6 5.5v3M6 3.5v.5" stroke="currentColor" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="je-tooltip je-tooltip--bottom"
          style={{ whiteSpace: "normal", minWidth: 180, maxWidth: 240, right: 0, left: "auto", transform: "none" }}
        >
          <span className="je-tooltip__hint">{text}</span>
        </span>
      )}
    </span>
  );
}

export function FieldLabel({ label, info }: { label: string; info: string }) {
  return (
    <div className="je-props__field-label-row">
      <label style={{ marginBottom: 0 }}>{label}</label>
      <FieldInfo text={info} />
    </div>
  );
}
