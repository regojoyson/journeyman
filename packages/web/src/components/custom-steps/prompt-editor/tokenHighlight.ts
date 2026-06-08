import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { tokenRanges, TOKEN_CLASS } from "./token-ranges.ts";

/**
 * Highlight {{input}} / $SLOT tokens in the document. Known names get the
 * input/slot class; undeclared names get the `unknown` class. Rebuilt on every
 * doc or viewport change, scanning only the visible ranges.
 */
export function tokenHighlighter(inputNames: Set<string>, slotNames: Set<string>) {
  const marks: Record<string, Decoration> = {
    [TOKEN_CLASS.input]: Decoration.mark({ class: TOKEN_CLASS.input }),
    [TOKEN_CLASS.slot]: Decoration.mark({ class: TOKEN_CLASS.slot }),
    [TOKEN_CLASS.unknown]: Decoration.mark({ class: TOKEN_CLASS.unknown }),
  };

  function build(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      for (const r of tokenRanges(text, inputNames, slotNames)) {
        builder.add(from + r.from, from + r.to, marks[r.cls]);
      }
    }
    return builder.finish();
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
      }
    },
    { decorations: v => v.decorations },
  );
}
