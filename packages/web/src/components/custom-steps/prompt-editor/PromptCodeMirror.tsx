import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { namesOf } from "./prompt-tokens.ts";
import { tokenHighlighter } from "./tokenHighlight.ts";
import { tokenAutocomplete } from "./tokenAutocomplete.ts";
import { wrapSelection } from "./editor-commands.ts";

export interface PromptCodeMirrorHandle {
  insertAtCursor: (snippet: string) => void;
  applyCommand: (build: (state: EditorState) => TransactionSpec) => void;
}

const formattingKeymap = keymap.of([
  { key: "Mod-b", run: v => { v.dispatch(wrapSelection(v.state, "**", "**")); return true; } },
  { key: "Mod-i", run: v => { v.dispatch(wrapSelection(v.state, "*", "*")); return true; } },
]);

// Token class names must match TOKEN_CLASS in token-ranges.ts.
const editorTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "#e2e8f0", fontSize: "13px" },
    ".cm-content": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      caretColor: "#a5b4fc",
      lineHeight: "1.55",
    },
    ".cm-gutters": { backgroundColor: "transparent", color: "#475569", border: "none" },
    ".cm-token-input": { color: "#6ee7b7" },
    ".cm-token-slot": { color: "#a5b4fc" },
    ".cm-token-unknown": { color: "#fcd34d", textDecoration: "underline wavy #f59e0b" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(99,102,241,0.4)",
    },
  },
  { dark: true },
);

export const PromptCodeMirror = forwardRef<
  PromptCodeMirrorHandle,
  {
    value: string;
    onChange: (next: string) => void;
    inputFields: CustomStepInputField[];
    slots: SecretSlotDef[];
    height: string;
  }
>(function PromptCodeMirror({ value, onChange, inputFields, slots, height }, ref) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      formattingKeymap,
      tokenHighlighter(namesOf(inputFields), namesOf(slots)),
      tokenAutocomplete(inputFields, slots),
      editorTheme,
    ],
    [inputFields, slots],
  );

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(snippet: string) {
        const view = cmRef.current?.view;
        if (!view) {
          onChange(value + snippet);
          return;
        }
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: snippet },
          selection: { anchor: from + snippet.length },
        });
        view.focus();
      },
      applyCommand(build: (state: EditorState) => TransactionSpec) {
        const view = cmRef.current?.view;
        if (!view) return;
        view.dispatch(build(view.state));
        view.focus();
      },
    }),
    [value, onChange],
  );

  return (
    <CodeMirror
      ref={cmRef}
      value={value}
      height={height}
      theme="none"
      extensions={extensions}
      onChange={onChange}
      // closeBrackets off: auto-closing `{` to `{}` would duplicate the `}}`
      // that the {{token}} autocomplete already inserts (→ `{{name}}}}`).
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false, closeBrackets: false }}
      placeholder="Write your prompt. Reference inputs with {{name}} and env secrets with $SLOT_NAME."
    />
  );
});
