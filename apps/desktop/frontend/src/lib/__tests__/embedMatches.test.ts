import { describe, expect, it } from "vitest";

import { findEmbeds } from "@novalis/editor";

describe("findEmbeds", () => {
  it("finds a standalone embed", () => {
    expect(findEmbeds("![[Note]]")).toEqual([{ from: 0, to: 9, target: "Note" }]);
  });

  it("trims the target", () => {
    expect(findEmbeds("![[  Daily Note  ]]")).toEqual([
      { from: 0, to: 19, target: "Daily Note" },
    ]);
  });

  it("keeps a #section anchor verbatim", () => {
    expect(findEmbeds("![[Note#Overview]]").map((e) => e.target)).toEqual(["Note#Overview"]);
  });

  it("ignores a plain wikilink with no leading !", () => {
    expect(findEmbeds("[[Note]]")).toEqual([]);
  });

  it("finds multiple embeds", () => {
    expect(findEmbeds("![[A]] and ![[B]]").map((e) => e.target)).toEqual(["A", "B"]);
  });

  it("ignores an empty target", () => {
    expect(findEmbeds("![[]]")).toEqual([]);
    expect(findEmbeds("![[   ]]")).toEqual([]);
  });
});
