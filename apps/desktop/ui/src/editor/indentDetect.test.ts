import { describe, expect, it } from "vitest";

import { detectIndent } from "./indentDetect";

describe("detectIndent", () => {
  it("reads two and four spaces from the steps between lines", () => {
    expect(detectIndent("a\n  b\n    c\n  d\n    e\nf\n")).toBe("  ");
    expect(detectIndent("fn main() {\n    let a = 1;\n    if a {\n        b();\n    }\n}\n")).toBe("    ");
  });

  it("reads tabs when most indented lines start with one", () => {
    expect(detectIndent("all:\n\tcc a.c\n\tcc b.c\nclean:\n\trm a\n\trm b\n")).toBe("\t");
  });

  it("stays silent on a file that gives too little away", () => {
    expect(detectIndent("")).toBeNull();
    expect(detectIndent("one\ntwo\n  three\n")).toBeNull();
    expect(detectIndent("a\n   b\n      c\n   d\n      e\n")).toBeNull();
  });

  it("looks at the first lines only", () => {
    const head = Array.from({ length: 200 }, () => "flat").join("\n");
    const tail = "\n\ta\n\tb\n\tc\n\td\n";
    expect(detectIndent(head + tail)).toBeNull();
  });
});
