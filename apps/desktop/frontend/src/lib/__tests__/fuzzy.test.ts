import { describe, expect, it } from "vitest";

import { fuzzyRank, fuzzyScore } from "../fuzzy";

describe("fuzzyScore", () => {
  it("matches a subsequence", () => {
    expect(fuzzyScore("New Note", "nn")).not.toBeNull();
    expect(fuzzyScore("New Note", "newnote")).not.toBeNull();
  });

  it("returns null when chars are missing or out of order", () => {
    expect(fuzzyScore("New Note", "xyz")).toBeNull();
    expect(fuzzyScore("abc", "cb")).toBeNull();
  });

  it("scores an empty query as 0", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });

  it("rewards consecutive matches over scattered ones", () => {
    expect(fuzzyScore("abc", "abc")!).toBeGreaterThan(fuzzyScore("axbxc", "abc")!);
  });

  it("rewards a start/word-boundary match", () => {
    expect(fuzzyScore("note", "n")!).toBeGreaterThan(fuzzyScore("anode", "n")!);
  });
});

describe("fuzzyRank", () => {
  it("returns the list unchanged for an empty query", () => {
    const items = ["a", "b"];
    expect(fuzzyRank(items, "", (x) => x)).toBe(items);
  });

  it("filters out non-matches and ranks best first", () => {
    const ranked = fuzzyRank(["New Note", "Settings", "New Folder"], "nn", (x) => x);
    expect(ranked).not.toContain("Settings");
    expect(ranked[0]).toBe("New Note");
  });
});
