import { describe, expect, it } from "vitest";

import { resolveLine } from "./editorBridge";

describe("resolveLine", () => {
  const text = "# A\n\nsee [[B]] once\nplain\nsee [[B]] once\n\nsee [[B]] once\n";

  it("keeps the indexed line while its text still matches", () => {
    expect(resolveLine(text, { line: 3, snippet: "see [[B]] once" })).toBe(3);
  });

  it("follows the text to the nearest matching line when the link has moved", () => {
    expect(resolveLine(text, { line: 4, snippet: "see [[B]] once" })).toBe(3);
    expect(resolveLine(text, { line: 6, snippet: "see [[B]] once" })).toBe(5);
    expect(resolveLine(text, { line: 40, snippet: "see [[B]] once" })).toBe(7);
  });

  it("matches a cut-down snippet by what is left of it", () => {
    expect(resolveLine(text, { line: 1, snippet: "…[[B]] once" })).toBe(3);
  });

  it("falls back to the indexed line without a snippet or a match", () => {
    expect(resolveLine(text, { line: 4, snippet: "" })).toBe(4);
    expect(resolveLine(text, { line: 4, snippet: "gone" })).toBe(4);
  });
});
