import { describe, expect, it } from "vitest";

import {
  parseContainer,
  parseNav,
  parseNcx,
  parsePackage,
  resolveEntry,
  tocChapters,
} from "./epub";

describe("resolveEntry", () => {
  it("reads an href as the file it stands in would", () => {
    expect(resolveEntry("OEBPS/content.opf", "text/ch1.xhtml")).toBe("OEBPS/text/ch1.xhtml");
    expect(resolveEntry("OEBPS/text/ch1.xhtml", "../images/a.png")).toBe("OEBPS/images/a.png");
    expect(resolveEntry("OEBPS/text/ch1.xhtml", "./ch2.xhtml")).toBe("OEBPS/text/ch2.xhtml");
    expect(resolveEntry("", "OEBPS/content.opf")).toBe("OEBPS/content.opf");
    expect(resolveEntry("OEBPS/content.opf", "/OEBPS/a.xhtml")).toBe("OEBPS/a.xhtml");
  });

  it("drops the fragment and decodes what a URL escaped", () => {
    expect(resolveEntry("OEBPS/nav.xhtml", "ch1.xhtml#part-2")).toBe("OEBPS/ch1.xhtml");
    expect(resolveEntry("OEBPS/nav.xhtml", "Kapitel%201.xhtml")).toBe("OEBPS/Kapitel 1.xhtml");
    // A stray `%` is not an escape; the name stays as it was written.
    expect(resolveEntry("OEBPS/nav.xhtml", "100%.xhtml")).toBe("OEBPS/100%.xhtml");
    expect(resolveEntry("OEBPS/nav.xhtml", "#only-a-fragment")).toBe("");
  });

  it("cannot be walked out of the archive", () => {
    expect(resolveEntry("OEBPS/text/ch1.xhtml", "../../../../etc/passwd")).toBe("etc/passwd");
  });
});

describe("parseContainer", () => {
  // `full-path` is spelled from the root of the archive, not from the
  // directory `container.xml` lies in.
  it("finds the package document the container points at", () => {
    const xml = `<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`;
    expect(parseContainer(xml)).toBe("OEBPS/content.opf");
  });

  it("is null for something that is not a container", () => {
    expect(parseContainer("<container><rootfiles/></container>")).toBeNull();
    expect(parseContainer("not xml at all <")).toBeNull();
  });
});

const OPF = `<?xml version="1.0"?>
  <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title>The Moon</dc:title>
    </metadata>
    <manifest>
      <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="scripted nav"/>
      <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
      <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    </manifest>
    <spine toc="ncx">
      <itemref idref="c1"/>
      <itemref idref="c2"/>
      <itemref idref="missing"/>
    </spine>
  </package>`;

describe("parsePackage", () => {
  it("reads the title, the reading order and both tables of contents", () => {
    const pkg = parsePackage(OPF, "OEBPS/content.opf");
    expect(pkg).toEqual({
      title: "The Moon",
      spine: ["OEBPS/text/ch1.xhtml", "OEBPS/text/ch2.xhtml"],
      navPath: "OEBPS/nav.xhtml",
      ncxPath: "OEBPS/toc.ncx",
    });
  });

  it("is null for a package that will not parse", () => {
    expect(parsePackage("<package><manifest>", "a.opf")).toBeNull();
  });

  it("has an empty spine when nothing in it is in the manifest", () => {
    const xml = `<package><manifest/><spine><itemref idref="x"/></spine></package>`;
    expect(parsePackage(xml, "a.opf")?.spine).toEqual([]);
  });
});

describe("parseNav and parseNcx", () => {
  it("flattens an EPUB 3 navigation document", () => {
    const xml = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body>
        <nav epub:type="landmarks"><ol><li><a href="text/ch1.xhtml">Start</a></li></ol></nav>
        <nav epub:type="toc">
          <ol>
            <li><a href="text/ch1.xhtml">One</a>
              <ol><li><a href="text/ch1.xhtml#b">One, later</a></li></ol>
            </li>
            <li><a href="text/ch2.xhtml">Two</a></li>
          </ol>
        </nav>
      </body></html>`;
    expect(parseNav(xml, "OEBPS/nav.xhtml")).toEqual([
      { label: "One", href: "OEBPS/text/ch1.xhtml" },
      { label: "One, later", href: "OEBPS/text/ch1.xhtml" },
      { label: "Two", href: "OEBPS/text/ch2.xhtml" },
    ]);
  });

  it("reads an EPUB 2 NCX", () => {
    const xml = `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
      <navMap>
        <navPoint><navLabel><text>One</text></navLabel><content src="text/ch1.xhtml"/></navPoint>
        <navPoint><navLabel><text>Two</text></navLabel><content src="text/ch2.xhtml"/></navPoint>
      </navMap></ncx>`;
    expect(parseNcx(xml, "OEBPS/toc.ncx")).toEqual([
      { label: "One", href: "OEBPS/text/ch1.xhtml" },
      { label: "Two", href: "OEBPS/text/ch2.xhtml" },
    ]);
  });
});

describe("tocChapters", () => {
  const spine = ["a.xhtml", "b.xhtml", "c.xhtml"];

  it("keeps one row per document, in reading order", () => {
    const toc = [
      { label: "B", href: "b.xhtml" },
      { label: "B again", href: "b.xhtml" },
      { label: "A", href: "a.xhtml" },
      { label: "Nowhere", href: "z.xhtml" },
    ];
    expect(tocChapters(toc, spine)).toEqual([
      { label: "A", index: 0 },
      { label: "B", index: 1 },
    ]);
  });

  it("falls back to the entry name when the book labels nothing", () => {
    expect(tocChapters([{ label: "", href: "c.xhtml" }], spine)).toEqual([
      { label: "c.xhtml", index: 2 },
    ]);
  });
});
