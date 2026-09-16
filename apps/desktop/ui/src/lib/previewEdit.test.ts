import { describe, expect, it } from "vitest";

import { parseBlockSpan, toggleMarkInSource } from "./previewEdit";

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
