import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineBreakOf, lineSeparatorFor } from "./lineBreak";

describe("lineBreakOf", () => {
  it("is CRLF only when every break is CRLF", () => {
    expect(lineBreakOf("a\r\nb\r\n")).toBe("\r\n");
    expect(lineBreakOf("a\nb")).toBe("\n");
    expect(lineBreakOf("one line")).toBe("\n");
    expect(lineBreakOf("a\r\nb\nc")).toBe("\n");
    expect(lineBreakOf("\na\r\nb")).toBe("\n");
    expect(lineBreakOf("a\r\nb\rc")).toBe("\n");
  });
});

describe("lineSeparatorFor", () => {
  // The buffer is read with `sliceDoc()`, which joins with the separator;
  // `doc.toString()` would always join with `\n`.
  it("keeps a CRLF file CRLF through an edit, typed line breaks included", () => {
    const text = "# Title\r\n\r\nbody\r\n";
    let state = EditorState.create({ doc: text, extensions: lineSeparatorFor(text) });
    expect(state.sliceDoc()).toBe(text);

    state = state.update({ changes: { from: 7, insert: `!${state.lineBreak}new` } }).state;
    expect(state.sliceDoc()).toBe("# Title!\r\nnew\r\n\r\nbody\r\n");
  });

  it("leaves an LF file alone", () => {
    const text = "a\nb\n";
    const state = EditorState.create({ doc: text, extensions: lineSeparatorFor(text) });
    expect(state.sliceDoc()).toBe(text);
    expect(state.lineBreak).toBe("\n");
  });
});
