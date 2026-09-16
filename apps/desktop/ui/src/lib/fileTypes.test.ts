import { describe, expect, it } from "vitest";

import { isSupported, mimeOf, viewKind } from "./fileTypes";

describe("fileTypes", () => {
  it("lists the §7.3 text types and the tier-D viewer types, nothing else", () => {
    for (const path of ["a.md", "notes/b.txt", "c.json", "Notes.TXT", "d.pdf", "e.PNG", "Makefile", "sub/LICENSE"]) {
      expect(isSupported(path), path).toBe(true);
    }
    for (const path of ["song.wav", "clip.mp4", "book.epub", "archive.zip", "README", "x.docx"]) {
      expect(isSupported(path), path).toBe(false);
    }
  });

  it("tells the viewer types apart from text", () => {
    expect(viewKind("a.pdf")).toBe("pdf");
    expect(viewKind("a.JPG")).toBe("image");
    expect(viewKind("a.svg")).toBeNull();
    expect(viewKind("a.md")).toBeNull();
    expect(mimeOf("a.pdf")).toBe("application/pdf");
    expect(mimeOf("a.jpeg")).toBe("image/jpeg");
  });
});
