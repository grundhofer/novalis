import { describe, expect, it } from "vitest";

import { headingLine, headingsOf } from "./headings";

describe("headingsOf", () => {
  it("lists the headings with their line, closing hashes dropped, fences skipped", () => {
    const text = "# Title\r\n\ntext\n## Part two ##\n```sh\n# not a heading\n```\n### Deep\n#nospace\n";
    expect(headingsOf(text)).toEqual([
      { line: 1, text: "# Title", title: "Title" },
      { line: 4, text: "## Part two", title: "Part two" },
      { line: 8, text: "### Deep", title: "Deep" },
    ]);
  });

  it("closes a fence only with the same character, at least as long", () => {
    expect(headingsOf("````\n```\n# inside\n````\n# after\n").map((h) => h.line)).toEqual([5]);
    expect(headingsOf("~~~\n```\n# inside\n~~~\n").map((h) => h.line)).toEqual([]);
  });
});

describe("headingLine", () => {
  it("finds the first heading of that text, ignoring case", () => {
    const text = "# Plan\n\n## Open Questions\n\n## open questions\n";
    expect(headingLine(text, "open questions")).toBe(3);
    expect(headingLine(text, " Plan ")).toBe(1);
    expect(headingLine(text, "Missing")).toBeNull();
  });
});
