import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { useTheme } from "@journeyman/theme";
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

// Colors come from the theme CSS variables so the editor follows light/dark.
// Token class names must match TOKEN_CLASS in token-ranges.ts.
function makeEditorTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": { backgroundColor: "transparent", color: "rgb(var(--color-text))", fontSize: "13px" },
      ".cm-content": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        caretColor: "rgb(var(--color-accent))",
        lineHeight: "1.55",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "rgb(var(--color-text-subtle))",
        border: "none",
      },
      ".cm-token-input": { color: "rgb(var(--color-success))" },
      ".cm-token-slot": { color: "rgb(var(--color-accent))" },
      ".cm-token-unknown": {
        color: "rgb(var(--color-warning))",
        textDecoration: "underline wavy rgb(var(--color-warning))",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "rgb(var(--color-accent) / 0.3)",
      },
    },
    { dark },
  );
}

export const PromptCodeMirror = forwardRef<
  PromptCodeMirrorHandle,
  {
    value: string;
    onChange: (next: string) => void;
    inputFields: CustomStepInputField[];
    slots: SecretSlotDef[];
    height: string;
    readOnly?: boolean;
  }
>(function PromptCodeMirror({ value, onChange, inputFields, slots, height, readOnly = false }, ref) {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const { theme } = useTheme();

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      formattingKeymap,
      tokenHighlighter(namesOf(inputFields), namesOf(slots)),
      tokenAutocomplete(inputFields, slots),
      makeEditorTheme(theme === "dark"),
      ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    ],
    [inputFields, slots, theme, readOnly],
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
