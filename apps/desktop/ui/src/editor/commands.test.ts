import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

// CI runs in UTC; east of UTC, 00:30 local is still the day before in UTC.
vi.stubEnv("TZ", "Europe/Berlin");

import { runEditorCommand } from "../lib/editorBridge";
import { setActiveView } from "./commands";

function view(doc: string, selection: EditorSelection): EditorView {
  const v = new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
  });
  setActiveView(v);
  return v;
}

afterEach(() => {
  setActiveView(null);
  vi.useRealTimers();
});

// ADR-0026: the ISO form in local time, at every cursor, over a selection.
describe("editor.insertDateTime", () => {
  it("inserts local YYYY-MM-DD HH:MM at every cursor and replaces a selection", () => {
    vi.setSystemTime(new Date(2026, 8, 14, 0, 5));
    const v = view(
      "a\nold\nb",
      EditorSelection.create([EditorSelection.cursor(1), EditorSelection.range(2, 5)]),
    );

    expect(runEditorCommand("editor.insertDateTime")).toBe(true);

    expect(v.state.doc.toString()).toBe("a2026-09-14 00:05\n2026-09-14 00:05\nb");
    v.destroy();
  });
});

// ADR-0029: the lines a selection covers, or the whole note for sort.
describe("editor.sortLines", () => {
  it("sorts the whole note when nothing is selected, ignoring case, numbers by value", () => {
    const v = view("b\nA\nitem 10\nitem 9\na", EditorSelection.single(0));
    expect(runEditorCommand("editor.sortLines")).toBe(true);
    expect(v.state.doc.toString()).toBe("A\na\nb\nitem 9\nitem 10");
    v.destroy();
  });

  it("sorts only the lines a selection covers, not the line it ends at the start of", () => {
    const doc = "z\nc\nb\na\ny";
    const v = view(doc, EditorSelection.single(2, doc.indexOf("a")));
    runEditorCommand("editor.sortLines");
    expect(v.state.doc.toString()).toBe("z\nb\nc\na\ny");
    v.destroy();
  });

  it("does nothing on sorted lines", () => {
    const v = view("a\nb", EditorSelection.single(0));
    expect(runEditorCommand("editor.sortLines")).toBe(false);
    v.destroy();
  });
});

describe("editor.joinLines", () => {
  it("joins a cursor's line with the next, dropping its indentation", () => {
    const v = view("- item\n    continued\nnext", EditorSelection.single(1));
    runEditorCommand("editor.joinLines");
    expect(v.state.doc.toString()).toBe("- item continued\nnext");
    v.destroy();
  });

  it("joins every line of a selection, one space between, none for an empty line", () => {
    const doc = "a\n\n b  \nc\nd";
    const v = view(doc, EditorSelection.single(0, doc.indexOf("c") + 1));
    runEditorCommand("editor.joinLines");
    expect(v.state.doc.toString()).toBe("a b c\nd");
    v.destroy();
  });

  it("does nothing on the last line", () => {
    const v = view("a\nb", EditorSelection.single(3));
    expect(runEditorCommand("editor.joinLines")).toBe(false);
    v.destroy();
  });
});
