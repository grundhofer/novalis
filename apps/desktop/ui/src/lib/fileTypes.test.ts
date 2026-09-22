import { describe, expect, it } from "vitest";

import { isSupported, kindOf, MIME, mimeOf, VIEW_EXTENSIONS, viewKind } from "./fileTypes";
import { EXTENSION_KINDS } from "./fileTypes.generated";

describe("fileTypes", () => {
  // The list is the shell's (ADR-0022); the viewer and the MIME type are the
  // UI's. A `view` row without a viewer would open nothing; a viewer entry
  // without a row would never be reached.
  it("gives every view row of the generated table a viewer and a MIME type, and no other", () => {
    const viewRows = Object.entries(EXTENSION_KINDS)
      .filter(([, kind]) => kind === "view")
      .map(([extension]) => extension)
      .sort();
    expect(Object.keys(VIEW_EXTENSIONS).sort()).toEqual(viewRows);
    expect(Object.keys(MIME).sort()).toEqual(viewRows);
    expect(kindOf("a.md")).toBe("note");
    expect(kindOf("a.markdown")).toBe("text");
    expect(kindOf("Makefile")).toBe("text");
    expect(kindOf("a.pdf")).toBe("view");
    expect(kindOf("a.wav")).toBeNull();
  });

  // The list is the plan's §3.1 (ADR-0022 point 2): its §3.3 names what is
  // never listed — media, archives, source maps, one-letter and numeric
  // extensions, the ambiguous `.m` — and stays out until someone asks.
  it("lists the §7.3 text types and the tier-D viewer types, nothing else", () => {
    for (const path of [
      "a.md",
      "notes/b.txt",
      "c.json",
      "Notes.TXT",
      "d.pdf",
      "e.PNG",
      "Makefile",
      "sub/LICENSE",
      "README",
      "docs/CHANGELOG",
      "main.go",
      "a.tex",
      "notes.org",
      "Gemfile",
      "build/Dockerfile.dev",
      "Containerfile",
      "justfile",
      "x.diff",
      "index.php",
      "books/book.epub",
      "comics/issue.cbz",
      "briefe/brief.docx",
    ]) {
      expect(isSupported(path), path).toBe(true);
    }
    for (const path of [
      "song.wav",
      "clip.mp4",
      "archive.zip",
      // Word's lock file beside an open document (ADR-0024).
      "~$brief.docx",
      "briefe/~$brief.docx",
      "app.js.map",
      "matrix.m",
      "boot.s",
      "syslog.1",
      "readme",
      "Dockerfile.",
      "Dockerfiles",
      "constructor",
      "a.toString",
    ]) {
      expect(isSupported(path), path).toBe(false);
    }
    expect(kindOf("Dockerfile.md")).toBe("note");
  });

  it("tells the viewer types apart from text", () => {
    expect(viewKind("a.pdf")).toBe("pdf");
    expect(viewKind("a.JPG")).toBe("image");
    expect(viewKind("a.EPUB")).toBe("epub");
    expect(viewKind("a.cbz")).toBe("cbz");
    expect(viewKind("a.DOCX")).toBe("docx");
    expect(viewKind("a.svg")).toBeNull();
    expect(viewKind("a.md")).toBeNull();
    expect(mimeOf("a.pdf")).toBe("application/pdf");
    expect(mimeOf("a.jpeg")).toBe("image/jpeg");
    expect(mimeOf("a.epub")).toBe("application/epub+zip");
    expect(mimeOf("a.cbz")).toBe("application/vnd.comicbook+zip");
    expect(mimeOf("a.docx")).toContain("wordprocessingml.document");
  });
});
