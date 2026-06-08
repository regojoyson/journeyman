import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";

/** Wrap the selection in `before`/`after`, keeping the original text selected. */
export function wrapSelection(state: EditorState, before: string, after: string): TransactionSpec {
  return state.changeByRange(range => {
    const text = state.sliceDoc(range.from, range.to);
    const anchor = range.from + before.length;
    return {
      changes: { from: range.from, to: range.to, insert: before + text + after },
      range: EditorSelection.range(anchor, anchor + text.length),
    };
  });
}

function selectedLines(state: EditorState) {
  const { from, to } = state.selection.main;
  const start = state.doc.lineAt(from).number;
  const end = state.doc.lineAt(to).number;
  const lines = [];
  for (let n = start; n <= end; n++) lines.push(state.doc.line(n));
  return lines;
}

const HEADING_RE = /^#{1,6} /;

/** Set (or toggle off) an ATX heading of `level` on each selected line. */
export function setHeading(state: EditorState, level: number): TransactionSpec {
  const marker = "#".repeat(level) + " ";
  const changes = selectedLines(state).map(line => {
    const existing = HEADING_RE.exec(line.text);
    const existingLen = existing ? existing[0].length : 0;
    const sameLevel = existing && existing[0] === marker;
    return { from: line.from, to: line.from + existingLen, insert: sameLevel ? "" : marker };
  });
  return { changes };
}

/** Add `prefix` to every selected line, or strip it if all lines already have it. */
export function toggleLinePrefix(state: EditorState, prefix: string): TransactionSpec {
  const lines = selectedLines(state);
  const allHave = lines.every(l => l.text.startsWith(prefix));
  const changes = lines.map(l =>
    allHave
      ? { from: l.from, to: l.from + prefix.length, insert: "" }
      : { from: l.from, insert: prefix },
  );
  return { changes };
}

const NUMBERED_RE = /^\d+\. /;

/** Number selected lines sequentially, or strip numbering if all are numbered. */
export function toggleNumberedList(state: EditorState): TransactionSpec {
  const lines = selectedLines(state);
  const allHave = lines.every(l => NUMBERED_RE.test(l.text));
  let i = 0;
  const changes = lines.map(l => {
    if (allHave) {
      const m = NUMBERED_RE.exec(l.text)!;
      return { from: l.from, to: l.from + m[0].length, insert: "" };
    }
    i += 1;
    return { from: l.from, insert: `${i}. ` };
  });
  return { changes };
}

/** Insert a `[text](url)` link, selecting `url` (or using the selection as text). */
export function insertLink(state: EditorState): TransactionSpec {
  return state.changeByRange(range => {
    const text = state.sliceDoc(range.from, range.to) || "text";
    const insert = `[${text}](url)`;
    const urlStart = range.from + 1 + text.length + 2; // "[" + text + "]("
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
}

/** Fence the selection (or an empty body) in a ``` code block. */
export function insertCodeBlock(state: EditorState): TransactionSpec {
  return state.changeByRange(range => {
    const body = state.sliceDoc(range.from, range.to);
    const anchor = range.from + 4; // "```\n"
    return {
      changes: { from: range.from, to: range.to, insert: "```\n" + body + "\n```" },
      range: EditorSelection.range(anchor, anchor + body.length),
    };
  });
}
