import { useState } from "react";

/** Static help copy for mapping a step input. Exported for reuse/testing. */
export const INPUT_HELP_TITLE = "Mapping this input";
export const INPUT_HELP_LINES: { label: string; body: string }[] = [
  { label: "Value", body: "type a fixed value." },
  { label: "@ Reference", body: "pull a value from an earlier step or the workflow input." },
  { label: "Path", body: "after picking a JSON or list reference, type a path: .fieldName (object field), [0] (item by position, first is 0), [*] (that field from every item → a list). e.g. payload.user.name, pullRequests[0].title, pullRequests[*].title" },
  { label: "Combine", body: "in Value mode, mix text and multiple @mentions to join values. e.g. @fullName/@ticketNumber → sam-repo/jrmen/6" },
];

export function InputHelp() {
  const [open, setOpen] = useState(false);
  return (
    <span className="je-input-help">
      <button
        type="button"
        className="je-input-help__icon"
        aria-label="How to map this input"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >i</button>
      {open && (
        <div className="je-input-help__popover" role="dialog">
          <h4 className="je-input-help__title">{INPUT_HELP_TITLE}</h4>
          {INPUT_HELP_LINES.map(l => (
            <p key={l.label} className="je-input-help__line">
              <b>{l.label}</b> — {l.body}
            </p>
          ))}
        </div>
      )}
    </span>
  );
}
