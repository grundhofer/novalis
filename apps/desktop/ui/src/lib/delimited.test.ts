import { describe, expect, it } from "vitest";

import { parseCsv, parseTsv } from "./delimited";

describe("parseCsv", () => {
  it("splits rows and cells, with a final line break or without", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads quoted cells: commas, doubled quotes and line breaks inside", () => {
    expect(parseCsv('name,note\n"Doe, Jane","said ""hi""\nand left"\n')).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'said "hi"\nand left'],
    ]);
    expect(parseCsv('"a\r\nb",c')).toEqual([["a\r\nb", "c"]]);
  });

  it("keeps empty cells and empty lines as rows", () => {
    expect(parseCsv(",a,\n\nb")).toEqual([["", "a", ""], [""], ["b"]]);
    expect(parseCsv('"",x')).toEqual([["", "x"]]);
  });

  it("is lenient where files are not", () => {
    // A quote inside an unquoted cell is kept as written.
    expect(parseCsv('5" screen,x')).toEqual([['5" screen', "x"]]);
    // A quote that never closes runs to the end.
    expect(parseCsv('a,"open\nstill')).toEqual([["a", "open\nstill"]]);
  });

  it("drops a byte-order mark and reads nothing from nothing", () => {
    expect(parseCsv("﻿id,x\n1,2")[0]).toEqual(["id", "x"]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("parseTsv", () => {
  it("splits on tabs and line breaks, with no quoting", () => {
    expect(parseTsv('a\tb\r\n"1"\t2, 3\n')).toEqual([
      ["a", "b"],
      ['"1"', "2, 3"],
    ]);
    expect(parseTsv("﻿x\ty")).toEqual([["x", "y"]]);
    expect(parseTsv("")).toEqual([]);
  });
});
