import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { indentLevels } from "./indentationGuides";

const levels = (lines: string[], unit = 4, tabSize = 4, first = 1, last = lines.length) =>
  indentLevels(Text.of(lines), first, last, unit, tabSize);

describe("indentLevels", () => {
  it("gives a content line one guide per started unit", () => {
    expect(levels(["a", "  b", "    c", "      d", "        e"], 4)).toEqual([0, 1, 1, 2, 2]);
    expect(levels(["a", "  b", "    c"], 2)).toEqual([0, 1, 2]);
  });

  it("counts a tab to the next stop, so a Makefile recipe lines up", () => {
    expect(levels(["all:", "\tcc a.c", "\t\tcc b.c", "  \tc"], 4, 4)).toEqual([0, 1, 2, 1]);
    expect(levels(["a", "\tb"], 8, 8)).toEqual([0, 1]);
  });

  it("keeps a gap inside a block at the block's depth", () => {
    // Between two lines of one block; between a deeper line and the block's
    // end; between a block's opener and its first line.
    expect(levels(["fn a() {", "    x();", "", "    y();", "}"])).toEqual([0, 1, 1, 1, 0]);
    expect(levels(["    if x {", "        y();", "", "    }"])).toEqual([1, 2, 2, 1]);
    expect(levels(["fn a() {", "", "    x();", "}"])).toEqual([0, 1, 1, 0]);
    // Whitespace-only lines are gaps too.
    expect(levels(["    a", "  \t ", "    b"])).toEqual([1, 1, 1]);
  });

  it("gives a gap between two top-level items, or at the file's ends, no guide", () => {
    expect(levels(["}", "", "", "fn b() {"])).toEqual([0, 0, 0, 0]);
    expect(levels(["", "    a", ""])).toEqual([0, 1, 0]);
    expect(levels([""])).toEqual([0]);
  });

  it("judges a gap at the viewport's edge by the lines outside it", () => {
    const lines = ["fn a() {", "    x();", "", "", "    y();", "}"];
    expect(levels(lines, 4, 4, 3, 4)).toEqual([1, 1]);
    expect(levels(lines, 4, 4, 4, 6)).toEqual([1, 1, 0]);
  });

  it("stops looking two hundred lines out", () => {
    const lines = ["    a", ...Array.from({ length: 250 }, () => ""), "    b"];
    const result = levels(lines);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(0);
    expect(result[251]).toBe(1);
    expect(result).toHaveLength(252);
  });
});
