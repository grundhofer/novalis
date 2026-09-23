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
