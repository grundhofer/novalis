import { describe, expect, it } from "vitest";

import { blockForLine, offsetOfLine, parseBlockSpan, toggleMarkInSource } from "./previewEdit";

describe("parseBlockSpan", () => {
  it("reads the renderer's attribute and refuses anything else", () => {
    expect(parseBlockSpan("12-34")).toEqual({ start: 12, end: 34 });
    expect(parseBlockSpan("34-12")).toBeNull();
    expect(parseBlockSpan("x")).toBeNull();
    expect(parseBlockSpan(null)).toBeNull();
  });
});

describe("toggleMarkInSource", () => {
  const text = "---\nt: x\n---\nOne **two** three\n\n- four five\n";
  const paragraph = { start: 13, end: 31 }; // "One **two** three\n"
  const item = { start: 32, end: 44 }; // "- four five\n"

  it("wraps a selection that occurs once in its block", () => {
    expect(toggleMarkInSource(text, paragraph, "three", "**")).toBe(
      "---\nt: x\n---\nOne **two** **three**\n\n- four five\n",
    );
    expect(toggleMarkInSource(text, item, "five", "_")).toBe(
      "---\nt: x\n---\nOne **two** three\n\n- four _five_\n",
    );
  });

  it("takes an existing marker off again", () => {
    expect(toggleMarkInSource(text, paragraph, "two", "**")).toBe("---\nt: x\n---\nOne two three\n\n- four five\n");
  });

  it("leaves the whitespace a loose selection carries outside the marker", () => {
    expect(toggleMarkInSource(text, paragraph, " three\n", "**")).toBe(
      "---\nt: x\n---\nOne **two** **three**\n\n- four five\n",
    );
  });

  it("refuses what it cannot place: absent, ambiguous, empty, out of range", () => {
    expect(toggleMarkInSource(text, paragraph, "two three", "**")).toBeNull();
    expect(toggleMarkInSource("aa aa", { start: 0, end: 5 }, "aa", "**")).toBeNull();
    expect(toggleMarkInSource(text, paragraph, "   ", "**")).toBeNull();
    expect(toggleMarkInSource(text, { start: 0, end: 999 }, "One", "**")).toBeNull();
  });
});

describe("offsetOfLine", () => {
  it("counts UTF-16 units up to the line's start", () => {
    const text = "ab\n😀c\n\nlast";
    expect(offsetOfLine(text, 1)).toBe(0);
    expect(offsetOfLine(text, 2)).toBe(3);
    expect(offsetOfLine(text, 3)).toBe(7);
    expect(offsetOfLine(text, 4)).toBe(8);
    expect(offsetOfLine(text, 5)).toBeNull();
    expect(offsetOfLine(text, 0)).toBeNull();
  });
});

describe("blockForLine", () => {
  // "---\nx: 1\n---\n" (13) then a heading, a blank line, a list of two items.
  const text = "---\nx: 1\n---\n# Head\n\n- one\n- two\n";
  const spans = [
    { start: 13, end: 20 }, // # Head
    { start: 21, end: 33 }, // the list
    { start: 21, end: 26 }, //   - one
    { start: 27, end: 33 }, //   - two
  ];

  it("picks the innermost block the line starts in", () => {
    expect(blockForLine(spans, text, 4)).toBe(0);
    expect(blockForLine(spans, text, 6)).toBe(2);
    expect(blockForLine(spans, text, 7)).toBe(3);
  });

  it("falls forward from a line no block covers, and back from the end", () => {
    expect(blockForLine(spans, text, 1)).toBe(0);
    expect(blockForLine(spans, text, 5)).toBe(1);
    expect(blockForLine(spans, text, 8)).toBe(3);
  });

  it("has nothing to show without blocks or past the text", () => {
    expect(blockForLine([], text, 4)).toBeNull();
    expect(blockForLine(spans, text, 40)).toBeNull();
  });
});

// ADR-0039: the list item's own line decides, by the editor's task rule.
describe("toggleTaskInSource", () => {
  it("flips the box on the item's first line, both ways", async () => {
    const { toggleTaskInSource } = await import("./previewEdit");
    const text = "- [ ] a\n  1. [X] b\n- plain\n";
    expect(toggleTaskInSource(text, { start: 0, end: 8 })).toBe("- [x] a\n  1. [X] b\n- plain\n");
    expect(toggleTaskInSource(text, { start: 8, end: 19 })).toBe("- [ ] a\n  1. [ ] b\n- plain\n");
    expect(toggleTaskInSource(text, { start: 19, end: 27 })).toBeNull();
    expect(toggleTaskInSource(text, { start: 0, end: 99 })).toBeNull();
  });
});
