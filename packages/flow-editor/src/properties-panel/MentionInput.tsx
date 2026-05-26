import { useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "./mention-serialize.ts";
import type { MentionField } from "./mention-fields.ts";

interface Props {
  value: Segment[];
  fields: MentionField[];
  placeholder?: string;
  readOnly?: boolean;
  onChange: (segments: Segment[]) => void;
}

const REF_ATTR = "data-ref";

function labelForRef(ref: string, fields: MentionField[]): string {
  const f = fields.find(x => x.ref === ref);
  if (!f) return ref; // stale binding — show raw ref
  const id = f.showId ? ` #${f.sourceId.slice(-6)}` : "";
  return `${f.sourceLabel}${id} · ${f.fieldPath}`;
}

function chipEl(ref: string, fields: MentionField[]): HTMLElement {
  const span = document.createElement("span");
  span.className = "je-mention-chip";
  span.setAttribute(REF_ATTR, ref);
  span.setAttribute("contenteditable", "false");
  span.textContent = labelForRef(ref, fields);
  return span;
}

/** Render segments into the contenteditable as text nodes + chip spans. */
function renderInto(el: HTMLElement, value: Segment[], fields: MentionField[]) {
  el.textContent = "";
  for (const seg of value) {
    if (seg.kind === "text") {
      el.appendChild(document.createTextNode(seg.text));
    } else {
      el.appendChild(chipEl(seg.ref, fields));
    }
  }
}

/** Read the contenteditable DOM back into Segment[]. */
function readSegments(el: HTMLElement): Segment[] {
  const segs: Segment[] = [];
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) segs.push({ kind: "text", text });
    } else if (node instanceof HTMLElement && node.hasAttribute(REF_ATTR)) {
      segs.push({ kind: "ref", ref: node.getAttribute(REF_ATTR)! });
    } else if (node instanceof HTMLElement) {
      const text = node.textContent ?? "";
      if (text) segs.push({ kind: "text", text });
    }
  });
  return segs;
}

function valueKey(value: Segment[]): string {
  return value.map(s => (s.kind === "text" ? `t:${s.text}` : `r:${s.ref}`)).join("|");
}
function fieldsKey(fields: MentionField[]): string {
  return fields.map(f => f.ref).join(",");
}

export function MentionInput({ value, fields, placeholder, readOnly, onChange }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ query: string } | null>(null);
  const [active, setActive] = useState(0);

  // Render initial value (and when the bound value changes externally).
  // Chips are atomic so re-rendering on local edits is unnecessary and would
  // reset the caret — key on serialized identity instead.
  useEffect(() => {
    if (ref.current) renderInto(ref.current, value, fields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsKey(fields), valueKey(value)]);

  const filtered = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    if (!q) return fields.slice(0, 50);
    return fields
      .filter(f => `${f.sourceLabel} ${f.fieldPath}`.toLowerCase().includes(q))
      .slice(0, 50);
  }, [menu, fields]);

  const emit = () => { if (ref.current) onChange(readSegments(ref.current)); };

  const insertChip = (f: MentionField) => {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && menu) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        const at = text.lastIndexOf("@", range.startOffset - 1);
        if (at >= 0) {
          node.textContent = text.slice(0, at) + text.slice(range.startOffset);
          const r = document.createRange();
          r.setStart(node, at);
          r.collapse(true);
          const chip = chipEl(f.ref, fields);
          r.insertNode(chip);
          r.setStartAfter(chip);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    }
    setMenu(null);
    setActive(0);
    emit();
  };

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    let q: string | null = null;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? "").slice(0, range.startOffset);
        const at = text.lastIndexOf("@");
        if (at >= 0 && !/\s/.test(text.slice(at + 1))) q = text.slice(at + 1);
      }
    }
    setMenu(q === null ? null : { query: q });
    setActive(0);
    emit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menu && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
      if (e.key === "Enter")     { e.preventDefault(); insertChip(filtered[active]); return; }
      if (e.key === "Escape")    { e.preventDefault(); setMenu(null); return; }
    }
  };

  return (
    <div className="je-mention">
      <div
        ref={ref}
        className="je-mention__editable"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Type, or @ to insert a value"}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onBlur={emit}
      />
      {menu && filtered.length > 0 && !readOnly && (
        <div className="je-mention__menu">
          {filtered.map((f, i) => (
            <div
              key={f.ref}
              className={`je-mention__item${i === active ? " je-mention__item--active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); insertChip(f); }}
            >
              <span className="je-mention__item-src">
                {f.sourceLabel}{f.showId ? ` #${f.sourceId.slice(-6)}` : ""}
              </span>
              <span className="je-mention__item-path">{f.fieldPath}</span>
              {f.type && <span className="je-mention__item-type">{f.type}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
