import { useCallback, useEffect, useRef, useState } from "react";
import {
  HANDLES, NODES, EDGES, INTERACTIONS, ADDING_PARAGRAPH,
  type LegendRow, type NodeRow,
} from "./help-content.tsx";

const STORAGE_KEY = "journeyman.flow-editor.help-seen";

function readSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true; // private mode → don't auto-open
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

function isTextInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  return false;
}

export function HelpPanel() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // First-run auto-open.
  useEffect(() => {
    if (!readSeen()) {
      setOpen(true);
      writeSeen();
    }
  }, []);

  // Keyboard: `?` toggles, Esc closes. Skip when a text field is focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (e.key === "?" && !isTextInputFocused()) {
        setOpen(o => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click outside the panel closes it. The toggle button is excluded.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = useCallback(() => {
    setOpen(o => {
      if (!o) writeSeen();
      return !o;
    });
  }, []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="je-help-btn"
        aria-label="Help"
        title="Help (?)"
        onClick={toggle}
      >
        ?
      </button>
      <aside
        ref={panelRef}
        className={`je-help-panel ${open ? "je-help-panel--open" : ""}`}
        aria-hidden={!open}
      >
        <header className="je-help-panel__header">
          <span>How to use the editor</span>
          <button
            type="button"
            className="je-help-panel__close"
            aria-label="Close help"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="je-help-panel__body">
          <Section title="Handles">
            {HANDLES.map(r => <LegendItem key={r.label} row={r} />)}
          </Section>
          <Section title="Node types">
            {NODES.map(n => <NodeItem key={n.label} row={n} />)}
          </Section>
          <Section title="Edge types">
            {EDGES.map(r => <LegendItem key={r.label} row={r} />)}
          </Section>
          <Section title="Interactions">
            <ul className="je-help-panel__list">
              {INTERACTIONS.map(s => <li key={s}>{s}</li>)}
            </ul>
          </Section>
          <Section title="Adding a node">
            <p className="je-help-panel__para">{ADDING_PARAGRAPH}</p>
          </Section>
        </div>
        <footer className="je-help-panel__footer">
          Press <kbd>?</kbd> to toggle, <kbd>Esc</kbd> to close.
        </footer>
      </aside>
    </>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="je-help-panel__section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function LegendItem(props: { row: LegendRow }) {
  return (
    <div className="je-help-panel__row">
      {props.row.swatch}
      <div>
        <div className="je-help-panel__row-label">{props.row.label}</div>
        <div className="je-help-panel__row-desc">{props.row.desc}</div>
      </div>
    </div>
  );
}

function NodeItem(props: { row: NodeRow }) {
  return (
    <div className="je-help-panel__row">
      <span className="je-help-panel__icon">{props.row.icon}</span>
      <div>
        <div className="je-help-panel__row-label">{props.row.label}</div>
        <div className="je-help-panel__row-desc">{props.row.desc}</div>
      </div>
    </div>
  );
}
