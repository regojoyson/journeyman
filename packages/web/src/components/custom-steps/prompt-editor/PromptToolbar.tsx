import type { ReactNode } from "react";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, SquareCode, Link as LinkIcon,
} from "lucide-react";
import {
  wrapSelection, setHeading, toggleLinePrefix, toggleNumberedList, insertLink, insertCodeBlock,
} from "./editor-commands.ts";

export type EditorCommand = (state: EditorState) => TransactionSpec;

function ToolButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => e.preventDefault()} // keep editor focus/selection
      onClick={onClick}
      className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-slate-700 mx-1" aria-hidden />;
}

const ICON = "w-3.5 h-3.5";

export function PromptToolbar({ onCommand }: { onCommand: (build: EditorCommand) => void }) {
  return (
    <div className="flex items-center gap-0.5 flex-wrap px-2 py-1 border-b border-slate-800 bg-slate-900/50">
      <ToolButton title="Bold (⌘B)" onClick={() => onCommand(s => wrapSelection(s, "**", "**"))}>
        <Bold className={ICON} />
      </ToolButton>
      <ToolButton title="Italic (⌘I)" onClick={() => onCommand(s => wrapSelection(s, "*", "*"))}>
        <Italic className={ICON} />
      </ToolButton>
      <ToolButton title="Strikethrough" onClick={() => onCommand(s => wrapSelection(s, "~~", "~~"))}>
        <Strikethrough className={ICON} />
      </ToolButton>
      <ToolButton title="Inline code" onClick={() => onCommand(s => wrapSelection(s, "`", "`"))}>
        <Code className={ICON} />
      </ToolButton>

      <Divider />

      <ToolButton title="Heading 1" onClick={() => onCommand(s => setHeading(s, 1))}>
        <Heading1 className={ICON} />
      </ToolButton>
      <ToolButton title="Heading 2" onClick={() => onCommand(s => setHeading(s, 2))}>
        <Heading2 className={ICON} />
      </ToolButton>
      <ToolButton title="Heading 3" onClick={() => onCommand(s => setHeading(s, 3))}>
        <Heading3 className={ICON} />
      </ToolButton>

      <Divider />

      <ToolButton title="Bullet list" onClick={() => onCommand(s => toggleLinePrefix(s, "- "))}>
        <List className={ICON} />
      </ToolButton>
      <ToolButton title="Numbered list" onClick={() => onCommand(s => toggleNumberedList(s))}>
        <ListOrdered className={ICON} />
      </ToolButton>
      <ToolButton title="Quote" onClick={() => onCommand(s => toggleLinePrefix(s, "> "))}>
        <Quote className={ICON} />
      </ToolButton>

      <Divider />

      <ToolButton title="Code block" onClick={() => onCommand(s => insertCodeBlock(s))}>
        <SquareCode className={ICON} />
      </ToolButton>
      <ToolButton title="Link" onClick={() => onCommand(s => insertLink(s))}>
        <LinkIcon className={ICON} />
      </ToolButton>
    </div>
  );
}
