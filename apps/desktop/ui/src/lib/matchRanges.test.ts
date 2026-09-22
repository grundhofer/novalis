import { describe, expect, it } from "vitest";

import { literalRanges, positionRanges, regexRanges } from "./matchRanges";

describe("matchRanges", () => {
  it("finds every literal occurrence, with or without case", () => {
    expect(literalRanges("Aa aa", "aa", false)).toEqual([
      [0, 2],
      [3, 5],
    ]);
    expect(literalRanges("Aa aa", "aa", true)).toEqual([[3, 5]]);
    expect(literalRanges("aaa", "aa", false)).toEqual([[0, 2]]);
    expect(literalRanges("x", "", false)).toEqual([]);
  });

  it("marks regex matches, skips empty ones and survives a pattern it cannot compile", () => {
    expect(regexRanges("a1 b22", "\\d+", false)).toEqual([
      [1, 2],
      [4, 6],
    ]);
    expect(regexRanges("ABC", "b", false)).toEqual([[1, 2]]);
    expect(regexRanges("abc", "x*", false)).toEqual([]);
    expect(regexRanges("abc", "(", false)).toEqual([]);
  });

  it("merges fuzzy positions into runs", () => {
    expect(positionRanges([0, 1, 2, 5, 7, 8])).toEqual([
      [0, 3],
      [5, 6],
      [7, 9],
    ]);
    expect(positionRanges([])).toEqual([]);
  });
});
