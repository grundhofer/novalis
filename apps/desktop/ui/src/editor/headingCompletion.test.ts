import { describe, expect, it } from "vitest";

import { headingsOf, parseHeadingLink } from "./headingCompletion";

describe("parseHeadingLink", () => {
  it("reads the note and the typed part off an open wikilink", () => {
    expect(parseHeadingLink("see [[Atlas Overview#Cha")).toEqual({
      target: "Atlas Overview",
      typed: "Cha",
      from: 21,
    });
    expect(parseHeadingLink("[[#")).toEqual({ target: "", typed: "", from: 3 });
  });

  it("is not a heading link without `[[`, after `|`, or after a second `#`", () => {
    expect(parseHeadingLink("a #tag")).toBeNull();
    expect(parseHeadingLink("[[A|label#x")).toBeNull();
    expect(parseHeadingLink("[[A#one#two")).toBeNull();
    expect(parseHeadingLink("[[A]] #")).toBeNull();
  });
});

describe("headingsOf", () => {
  it("lists the headings without their marks, in order", () => {
    expect(headingsOf("# Title\ntext\n## Second  \n#nottag\n###### Deep\n####### seven")).toEqual([
      "Title",
      "Second",
      "Deep",
    ]);
  });
});
