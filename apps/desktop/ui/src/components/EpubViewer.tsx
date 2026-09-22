import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { commands, NovalisError, unwrap } from "../ipc/client";
import {
  parseContainer,
  parseNav,
  parseNcx,
  parsePackage,
  resolveEntry,
  tocChapters,
  type TocEntry,
} from "../lib/epub";
import { mimeOf } from "../lib/fileTypes";
import { extensionOf, stemOf } from "../lib/paths";
import { sanitizeInto } from "../lib/sanitize";
import { report, useUi } from "../stores/ui";

/**
 * The EPUB reader (ADR-0023) — the app's own, not a library's.
 *
 * A book is a zip, and the shell reads inside it (`read_packed`): opening
 * one costs three small reads (container, package, table of contents) and a
 * chapter costs two more (the document, then everything it references).
 * Nothing is extracted and nothing is kept: leaving the tab frees the
 * chapter and revokes its images' URLs.
 *
 * What the chapter's XHTML says is never shown as it was written. It is
 * parsed into an inert document and copied through the allow-list of
 * `lib/sanitize` into a Shadow-DOM host, so the book's own markup cannot
 * reach the app's stylesheet and the app's cannot dress the book by
 * accident. The reader's typography is the editor's, `editor.fontSize`
 * included — a custom property crosses the shadow boundary, so the setting
 * needs no wiring here.
 *
 * Reading position is the session's (the chapter is state, not a file), and
 * the book is never written to. `Cmd+F` is not bound: docs/KEYMAP.md has no
 * `viewer` scope yet (ADR-0025).
 */

/** Where the reader stopped when a book will not open. */
type Refusal = "protected" | "unreadable";

interface Book {
  readonly title: string;
  readonly spine: readonly string[];
  /** The book's own table of contents, as spine positions; may be empty. */
  readonly chapters: readonly { label: string; index: number }[];
}

/** `https:`, `mailto:` and the like — the test `lib/links.ts` uses. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * What an image inside the book is handed to the WebView as. `mimeOf` knows
 * the four raster types the app lists (ADR-0015); a cover drawn as SVG is
 * the one thing a book may reference that the app itself never lists, and
 * an `<img>` runs nothing of it.
 */
function imageType(name: string): string {
  return extensionOf(name) === "svg" ? "image/svg+xml" : mimeOf(name);
}

/** The same lines as Viewer.tsx: base64 from the shell to bytes. */
function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The named entries of the book, by name; a missing one is simply absent. */
async function entriesOf(
  path: string,
  names: string[],
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const packed = await unwrap(commands.readPacked(path, names));
  return new Map(packed.parts.map((part) => [part.name, decode(part.base64)]));
}

/** One entry as text. EPUB mandates UTF-8 for its XML and its documents. */
async function textOf(path: string, name: string): Promise<string | null> {
  const bytes = (await entriesOf(path, [name])).get(name);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/** The book's structure: three reads, each one naming the next. */
async function openBook(path: string): Promise<Book | Refusal> {
  const container = await textOf(path, "META-INF/container.xml");
  const opfPath = container === null ? null : parseContainer(container);
  if (!opfPath) return "unreadable";

  const opf = await textOf(path, opfPath);
  const pkg = opf === null ? null : parsePackage(opf, opfPath);
  if (!pkg || pkg.spine.length === 0) return "unreadable";

  // EPUB 3 books carry both; the navigation document is the current one and
  // the NCX only its compatibility twin, so it is read first.
  const tocPath = pkg.navPath ?? pkg.ncxPath;
  let toc: TocEntry[] = [];
  if (tocPath) {
    const text = await textOf(path, tocPath);
    if (text !== null) toc = pkg.navPath ? parseNav(text, tocPath) : parseNcx(text, tocPath);
  }
  return { title: pkg.title, spine: pkg.spine, chapters: tocChapters(toc, pkg.spine) };
}

/**
 * The chapter's prose. The book's own stylesheets are not loaded (they
 * would bring fonts and remote URLs with them), so this is the whole dress
 * the text gets, and it follows the app's tokens in both appearances.
 */
const CHAPTER_CSS = `
:host { display: block; }
.body {
  max-width: var(--ds-measure-editor);
  margin: 0 auto;
  padding: var(--ds-space-7) var(--ds-space-6) var(--ds-space-9);
  color: var(--ds-color-fg-default);
  font-family: var(--ds-font-sans);
  font-size: var(--ds-font-size-editor);
  line-height: var(--ds-line-height-editor);
  overflow-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { margin: 1.6em 0 0.6em; line-height: 1.25; font-weight: var(--ds-font-weight-strong); }
h1 { font-size: 1.55em; letter-spacing: var(--ds-letter-spacing-title); }
h2 { font-size: 1.24em; }
h3 { font-size: 1.1em; }
p, ul, ol, dl, blockquote, table, figure { margin: 0 0 1em; }
ul, ol { padding-left: 1.5em; }
li { margin: 0.2em 0; }
blockquote {
  padding-left: var(--ds-space-4);
  border-left: 2px solid var(--ds-color-border-strong);
  color: var(--ds-color-fg-muted);
}
a { color: var(--ds-color-syntax-link); text-decoration: underline; cursor: pointer; }
code, pre, kbd, samp { font-family: var(--ds-font-mono); font-size: 0.9em; }
pre { padding: var(--ds-space-3); overflow-x: auto; background: var(--ds-color-bg-fill); border-radius: var(--ds-radius-control); }
img { display: block; max-width: 100%; height: auto; margin: 1em auto; }
hr { height: 1px; border: 0; margin: 2em 0; background: var(--ds-color-border-default); }
table { border-collapse: collapse; }
th, td { padding: var(--ds-space-2) var(--ds-space-3); border: 1px solid var(--ds-color-border-default); text-align: left; }
figcaption { color: var(--ds-color-fg-muted); font-size: 0.9em; text-align: center; }
`;

export default function EpubViewer({ path }: { path: string }) {
  const { t } = useTranslation();
  const [book, setBook] = useState<Book | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [chapter, setChapter] = useState(0);
  const [contentsOpen, setContentsOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // ---- the book ------------------------------------------------------------
  // Nothing is reset here: `Viewer` keys this component by path, so another
  // book is another mount and the state starts empty on its own.
  useEffect(() => {
    let cancelled = false;
    openBook(path)
      .then((opened) => {
        if (cancelled) return;
        if (typeof opened === "string") setRefusal(opened);
        else setBook(opened);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A DRM-protected book is not a failure to report: the banner says
        // what it is. Anything else is, and the banner says only that much.
        if (error instanceof NovalisError && error.code === "protected") setRefusal("protected");
        else {
          setRefusal("unreadable");
          report(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // ---- the chapter ---------------------------------------------------------
  // The shadow root is the effect's alone: React renders no children into
  // the host, so every run starts from an empty root and the previous
  // chapter's nodes and URLs are gone before the next ones arrive.
  useEffect(() => {
    if (!book) return undefined;
    const href = book.spine[chapter];
    const element = host.current;
    if (!href || !element) return undefined;
    let cancelled = false;
    const urls: string[] = [];
    const free = () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.length = 0;
    };

    void (async () => {
      const xhtml = await textOf(path, href);
      if (cancelled) return;
      const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CHAPTER_CSS;
      const body = document.createElement("div");
      body.className = "body";

      if (xhtml !== null) {
        // `text/html` and not `application/xhtml+xml`: a book whose XHTML is
        // not well formed would otherwise show a parser error instead of its
        // text, and the copy below cares about elements, not about syntax.
        const parsed = new DOMParser().parseFromString(xhtml, "text/html");
        body.append(sanitizeInto(parsed.body, document));

        const images = [...body.querySelectorAll<HTMLImageElement>("img[data-src]")];
        const wanted = [
          ...new Set(images.map((img) => resolveEntry(href, img.dataset.src ?? ""))),
        ].filter((name) => name !== "");
        if (wanted.length > 0) {
          const bytes = await entriesOf(path, wanted);
          for (const img of images) {
            const name = resolveEntry(href, img.dataset.src ?? "");
            const found = bytes.get(name);
            img.removeAttribute("data-src");
            // An image the book does not carry stays its alt text.
            if (!found) continue;
            const url = URL.createObjectURL(new Blob([found], { type: imageType(name) }));
            urls.push(url);
            img.src = url;
          }
        }
      }

      if (cancelled) {
        free();
        return;
      }
      root.replaceChildren(style, body);
      scroller.current?.scrollTo({ top: 0 });
    })().catch((error: unknown) => {
      if (!cancelled) report(error);
    });

    return () => {
      cancelled = true;
      free();
    };
  }, [book, chapter, path]);

  const count = book?.spine.length ?? 0;
  const goTo = (next: number) => {
    if (count === 0) return;
    setContentsOpen(false);
    setChapter(Math.min(count - 1, Math.max(0, next)));
  };

  // ---- links ---------------------------------------------------------------
  // A click inside the shadow root reaches the host retargeted, so the
  // anchor is found on the composed path and not on the event's target.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = event.nativeEvent
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!anchor || !book) return;
    // Nothing navigates the webview: a link is the book's business or nobody's.
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      const id = href.slice(1);
      const target = host.current?.shadowRoot?.getElementById(id);
      if (target && typeof target.scrollIntoView === "function") target.scrollIntoView();
      return;
    }
    if (SCHEME.test(href)) {
      // Mode 1 opens nothing outside the vault (docs/PRIVACY.md); the toast
      // says so rather than letting the click look broken.
      useUi.getState().showToast("editor.previewExternalLink");
      return;
    }
    const target = resolveEntry(book.spine[chapter] ?? "", href);
    const index = book.spine.indexOf(target);
    // A link to something the spine does not carry (an image, a page the
    // book left out of its own reading order) leads nowhere, and does so
    // quietly: the book is broken, not the reader.
    if (index >= 0) goTo(index);
  };

  if (refusal) {
    return (
      <div className="epub">
        <div className="banner" role="status">
          <span className="banner-body">
            {t(refusal === "protected" ? "viewer.epub.protected" : "viewer.epub.unreadable")}
          </span>
        </div>
      </div>
    );
  }
  if (!book) return <div className="pane-loading">{t("editor.loading")}</div>;

  const rows =
    book.chapters.length > 0
      ? book.chapters
      : book.spine.map((_, index) => ({
          label: t("viewer.epub.chapterNumber", { number: index + 1 }),
          index,
        }));

  return (
    <div className="epub">
      <header className="epub-bar">
        <button
          className={contentsOpen ? "btn ghost pdf-tool wide on" : "btn ghost pdf-tool wide"}
          type="button"
          aria-expanded={contentsOpen}
          onClick={() => setContentsOpen((open) => !open)}
        >
          {t("viewer.epub.contents")}
        </button>
        <span className="epub-title">{book.title || stemOf(path)}</span>
        <span className="pdf-spacer" />
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.epub.previousChapter")}
          aria-label={t("viewer.epub.previousChapter")}
          disabled={chapter <= 0}
          onClick={() => goTo(chapter - 1)}
        >
          &#8249;
        </button>
        <span className="epub-count">
          {t("viewer.epub.chapterOf", { current: chapter + 1, count })}
        </span>
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.epub.nextChapter")}
          aria-label={t("viewer.epub.nextChapter")}
          disabled={chapter >= count - 1}
          onClick={() => goTo(chapter + 1)}
        >
          &#8250;
        </button>
      </header>
      {contentsOpen && (
        <nav className="epub-contents" aria-label={t("viewer.epub.contents")}>
          <ul className="epub-contents-list">
            {rows.map((row) => (
              <li key={row.index}>
                <button
                  className={row.index === chapter ? "epub-contents-row on" : "epub-contents-row"}
                  type="button"
                  onClick={() => goTo(row.index)}
                >
                  {row.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="epub-scroll" ref={scroller}>
        <div className="epub-host" ref={host} onClick={onClick} />
      </div>
    </div>
  );
}
