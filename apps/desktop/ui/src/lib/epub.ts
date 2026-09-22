/**
 * What an EPUB says about itself (ADR-0023): the three small XML files that
 * lead from the container to the chapters, read with `DOMParser` and turned
 * into plain data. No bytes are fetched here and no DOM is shown — the
 * reader (`components/EpubViewer.tsx`) asks the shell for each file and
 * hands the text to these functions.
 *
 * The path through a book is fixed by the OCF and OPF specifications:
 *
 *   META-INF/container.xml → the OPF ("the package")
 *   the OPF               → the title, the spine (reading order), the TOC
 *   nav.xhtml (EPUB 3) or the NCX (EPUB 2) → the chapter names
 *
 * Every href in those files is relative to the file it stands in, so every
 * one of them goes through [`resolveEntry`] before it is an entry name the
 * shell can read.
 *
 * A malformed book is not an error here: a missing title is the file name's
 * job, a missing TOC is the spine's, and a spine that is empty is what the
 * reader reports. Only the two structural steps — container and package —
 * can fail, and they say so by returning null.
 */

export interface TocEntry {
  /** What the book calls this place. */
  readonly label: string;
  /** The entry name of the document it points at, fragment removed. */
  readonly href: string;
}

export interface EpubPackage {
  /** `dc:title`, or an empty string when the book names none. */
  readonly title: string;
  /** The documents in reading order, as entry names. */
  readonly spine: readonly string[];
  /** The EPUB 3 navigation document, as an entry name. */
  readonly navPath: string | null;
  /** The EPUB 2 NCX, as an entry name. */
  readonly ncxPath: string | null;
}

/** The elements of `name` in `root`, whatever namespace they carry. */
function byTag(root: Document | Element, name: string): Element[] {
  return [...root.getElementsByTagNameNS("*", name)];
}

/** An attribute by local name, whatever prefix the book used for it. */
function attribute(element: Element, name: string): string | null {
  for (const attr of element.attributes) {
    if (attr.localName.toLowerCase() === name) return attr.value;
  }
  return null;
}

/** An XML document, or null when the text is not well formed. */
function parse(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // The one portable way to see a parse error: the parser reports it as a
  // document whose root is `<parsererror>` (or which holds one).
  return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
}

/**
 * An href from inside `base` as an entry name of the archive: relative to
 * the *directory* `base` lies in, with `.` and `..` resolved, the fragment
 * dropped and percent escapes decoded — `href` is a URL, entry names are not.
 *
 * A `..` that would climb out of the archive is dropped, like the shell's
 * own normalization does, so nothing addresses a file outside the book.
 */
export function resolveEntry(base: string, href: string): string {
  const target = href.split("#")[0] ?? "";
  if (!target) return "";
  const parts = target.startsWith("/")
    ? target.slice(1).split("/")
    : base.split("/").slice(0, -1).concat(target.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  // NFC, because the shell normalizes the archive's own entry names the
  // same way and a decomposed name would never match a composed one.
  return decode(out.join("/")).normalize("NFC");
}

/** A percent-encoded name as written; a stray `%` is not an escape. */
function decode(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * The package document's entry name, from `META-INF/container.xml`.
 *
 * `full-path` is the one href in a book that is *not* relative to the file
 * it stands in: OCF spells it from the root of the archive.
 */
export function parseContainer(xml: string): string | null {
  const doc = parse(xml);
  if (!doc) return null;
  const rootfiles = byTag(doc, "rootfile");
  const chosen =
    rootfiles.find(
      (file) => attribute(file, "media-type") === "application/oebps-package+xml",
    ) ?? rootfiles[0];
  const full = chosen && attribute(chosen, "full-path");
  return full ? resolveEntry("", full) : null;
}

/**
 * The package document at `opfPath`: title, reading order, and where the
 * table of contents lives.
 *
 * Every `itemref` is kept, `linear="no"` included: those documents are the
 * book's own (a note, a cover), and a reader that hides them shows less
 * than the book has. The spine drops only what the manifest does not name.
 */
export function parsePackage(xml: string, opfPath: string): EpubPackage | null {
  const doc = parse(xml);
  if (!doc) return null;
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  for (const item of byTag(doc, "item")) {
    const id = attribute(item, "id");
    const href = attribute(item, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      href: resolveEntry(opfPath, href),
      mediaType: attribute(item, "media-type") ?? "",
      properties: attribute(item, "properties") ?? "",
    });
  }

  const spine: string[] = [];
  for (const ref of byTag(doc, "itemref")) {
    const idref = attribute(ref, "idref");
    const item = idref ? manifest.get(idref) : undefined;
    if (item) spine.push(item.href);
  }

  const title = byTag(doc, "title")[0]?.textContent?.trim() ?? "";

  const navItem = [...manifest.values()].find((item) =>
    item.properties.split(/\s+/).includes("nav"),
  );
  const spineElement = byTag(doc, "spine")[0];
  const tocId = spineElement ? attribute(spineElement, "toc") : null;
  const ncxItem =
    (tocId ? manifest.get(tocId) : undefined) ??
    [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml");

  return {
    title,
    spine,
    navPath: navItem?.href ?? null,
    ncxPath: ncxItem?.href ?? null,
  };
}

/**
 * The table of contents of an EPUB 3 navigation document at `navPath`: the
 * `<nav epub:type="toc">`, or the first `<nav>` when the book labels none.
 * A nested TOC is flattened — the bar lists places, not a tree.
 */
export function parseNav(xml: string, navPath: string): TocEntry[] {
  const doc = parse(xml);
  if (!doc) return [];
  const navs = byTag(doc, "nav");
  const toc = navs.find((nav) => attribute(nav, "type") === "toc") ?? navs[0];
  if (!toc) return [];
  return byTag(toc, "a")
    .map((anchor) => ({
      label: anchor.textContent?.trim() ?? "",
      href: resolveEntry(navPath, anchor.getAttribute("href") ?? ""),
    }))
    .filter((entry) => entry.href !== "");
}

/** The same for an EPUB 2 NCX at `ncxPath`, in document order. */
export function parseNcx(xml: string, ncxPath: string): TocEntry[] {
  const doc = parse(xml);
  if (!doc) return [];
  return byTag(doc, "navPoint")
    .map((point) => ({
      label: byTag(point, "text")[0]?.textContent?.trim() ?? "",
      href: resolveEntry(ncxPath, byTag(point, "content")[0]?.getAttribute("src") ?? ""),
    }))
    .filter((entry) => entry.href !== "");
}

/**
 * The table of contents as chapter numbers: every entry that names a
 * document of the spine, at most once per document, in spine order. An
 * entry pointing somewhere the spine does not go is dropped — it would be a
 * row that cannot be opened.
 */
export function tocChapters(
  toc: readonly TocEntry[],
  spine: readonly string[],
): { label: string; index: number }[] {
  const seen = new Set<number>();
  const out: { label: string; index: number }[] = [];
  for (const entry of toc) {
    const index = spine.indexOf(entry.href);
    if (index < 0 || seen.has(index)) continue;
    seen.add(index);
    out.push({ label: entry.label || entry.href, index });
  }
  return out.sort((a, b) => a.index - b.index);
}
