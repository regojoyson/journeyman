import { describe, it, expect } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import {
  wrapSelection,
  setHeading,
  toggleLinePrefix,
  toggleNumberedList,
  insertLink,
  insertCodeBlock,
} from "./editor-commands.ts";

function apply(
  doc: string,
  sel: { anchor: number; head: number },
  build: (state: EditorState) => TransactionSpec,
): string {
  const state = EditorState.create({ doc, selection: sel });
  return state.update(build(state)).state.doc.toString();
}

describe("wrapSelection", () => {
  it("wraps a selection", () => {
    expect(apply("abc", { anchor: 0, head: 3 }, s => wrapSelection(s, "**", "**"))).toBe("**abc**");
  });
  it("inserts empty markers at a cursor", () => {
    expect(apply("", { anchor: 0, head: 0 }, s => wrapSelection(s, "**", "**"))).toBe("****");
  });
});

describe("setHeading", () => {
  it("adds a heading marker", () => {
    expect(apply("title", { anchor: 0, head: 0 }, s => setHeading(s, 2))).toBe("## title");
  });
  it("toggles off when the same level is already set", () => {
    expect(apply("## title", { anchor: 0, head: 0 }, s => setHeading(s, 2))).toBe("title");
  });
  it("replaces an existing different level", () => {
    expect(apply("# title", { anchor: 0, head: 0 }, s => setHeading(s, 3))).toBe("### title");
  });
});

describe("toggleLinePrefix", () => {
  it("adds a prefix to each selected line", () => {
    expect(apply("a\nb", { anchor: 0, head: 3 }, s => toggleLinePrefix(s, "- "))).toBe("- a\n- b");
  });
  it("removes the prefix when all lines already have it", () => {
    expect(apply("- a\n- b", { anchor: 0, head: 7 }, s => toggleLinePrefix(s, "- "))).toBe("a\nb");
  });
});

describe("toggleNumberedList", () => {
  it("numbers each selected line sequentially", () => {
    expect(apply("a\nb", { anchor: 0, head: 3 }, s => toggleNumberedList(s))).toBe("1. a\n2. b");
  });
  it("removes numbering when all lines are numbered", () => {
    expect(apply("1. a\n2. b", { anchor: 0, head: 9 }, s => toggleNumberedList(s))).toBe("a\nb");
  });
});

describe("insertLink", () => {
  it("inserts a link skeleton at a cursor", () => {
    expect(apply("", { anchor: 0, head: 0 }, s => insertLink(s))).toBe("[text](url)");
  });
  it("uses the selection as the link text", () => {
    expect(apply("click", { anchor: 0, head: 5 }, s => insertLink(s))).toBe("[click](url)");
  });
});

describe("insertCodeBlock", () => {
  it("fences the selection", () => {
    expect(apply("x", { anchor: 0, head: 1 }, s => insertCodeBlock(s))).toBe("```\nx\n```");
  });
});
