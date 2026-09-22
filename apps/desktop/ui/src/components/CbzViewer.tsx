import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, NovalisError, unwrap } from "../ipc/client";
import { mimeOf } from "../lib/fileTypes";
import { extensionOf, fileNameOf } from "../lib/paths";
import { report } from "../stores/ui";
import ZoomableImage from "./ZoomableImage";

/**
 * The comic reader (ADR-0023) — the second reader on the same primitive as
 * the EPUB one, and the smaller of the two: a CBZ is a zip of images and
 * nothing else, so there is no manifest to follow and no markup to sanitize.
 *
 * Opening one costs a listing (`read_packed` with no names), and a page
 * costs one read of the page after it — the page shown is already in hand,
 * because the turn before fetched it. Only those two are kept: turning a
 * page frees what is now two pages back, so a 500 MB comic costs two pages
 * of memory, never more.
 *
 * The page is a `ZoomableImage` (ADR-0025), the image viewer's: it fits the
 * pane until zoomed, and a zoom stays as the pages turn.
 */

/** Where the reader stopped when a comic will not open, and what it says. */
const REFUSALS = {
  protected: "viewer.cbz.protected",
  unreadable: "viewer.cbz.unreadable",
  empty: "viewer.cbz.empty",
} as const;

type Refusal = keyof typeof REFUSALS;

/** What counts as a page. The four raster types of ADR-0015, and `jpeg`. */
const PAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** `2` before `10`, and the same order for an archive written on any Mac. */
const ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * The comic's pages: the image entries, in natural order.
 *
 * Two kinds of entry are images and not pages. A macOS archive carries a
 * resource fork beside every file (`__MACOSX/…/._page-01.jpg`), which is
 * neither a picture nor a page; and the archive's own order is whatever the
 * tool that wrote it chose, so `page-10` would come before `page-2` were
 * the names compared as text.
 */
export function comicPages(entries: readonly { name: string }[]): string[] {
  return entries
    .map((entry) => entry.name)
    .filter((name) => {
      if (name.startsWith("__MACOSX/") || fileNameOf(name).startsWith("._")) return false;
      return PAGE_EXTENSIONS.has(extensionOf(name));
    })
    .sort(ORDER.compare);
}

/** The same lines as Viewer.tsx: base64 from the shell to bytes. */
function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function CbzViewer({ path }: { path: string }) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<readonly string[] | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [page, setPage] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  /** The page shown and the one after it, as object URLs, by entry name. */
  const held = useRef(new Map<string, string>());

  // ---- the pages -----------------------------------------------------------
  // Nothing is reset here: `Viewer` keys this component by path, so another
  // comic is another mount and the state starts empty on its own.
  useEffect(() => {
    let cancelled = false;
    unwrap(commands.readPacked(path, []))
      .then((packed) => {
        if (cancelled) return;
        const names = comicPages(packed.entries);
        if (names.length === 0) setRefusal("empty");
        else setPages(names);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A protected archive is not a failure to report: the banner says
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

  // ---- the page and the one after it ---------------------------------------
  useEffect(() => {
    if (!pages) return undefined;
    const wanted = [pages[page], pages[page + 1]].filter((name): name is string => name !== undefined);
    let cancelled = false;

    void (async () => {
      const missing = wanted.filter((name) => !held.current.has(name));
      if (missing.length > 0) {
        const packed = await unwrap(commands.readPacked(path, missing));
        for (const part of packed.parts) {
          const blob = new Blob([decode(part.base64)], { type: mimeOf(part.name) });
          held.current.set(part.name, URL.createObjectURL(blob));
        }
      }
      // A newer turn is in charge from here: it holds what it needs and
      // frees what it does not, this one's fetch included.
      if (cancelled) return;
      // What is neither shown nor next is two pages back by now.
      for (const [name, url] of held.current) {
        if (wanted.includes(name)) continue;
        URL.revokeObjectURL(url);
        held.current.delete(name);
      }
      // A page the archive listed but will not hand over leaves the pane
      // empty rather than showing the page before it.
      setSrc(held.current.get(wanted[0] ?? "") ?? null);
    })().catch((error: unknown) => {
      if (!cancelled) report(error);
    });

    return () => {
      cancelled = true;
    };
  }, [pages, page, path]);

  // Leaving the tab frees both pages. The map is the ref's own, so this runs
  // once, on unmount, with whatever is held then.
  useEffect(() => {
    const urls = held.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  if (refusal) {
    return (
      <div className="cbz">
        <div className="banner" role="status">
          <span className="banner-body">{t(REFUSALS[refusal])}</span>
        </div>
      </div>
    );
  }
  if (!pages) return <div className="pane-loading">{t("editor.loading")}</div>;

  const count = pages.length;
  const label = t("viewer.cbz.pageOf", { current: page + 1, count });
  const goTo = (next: number) => setPage(Math.min(count - 1, Math.max(0, next)));

  return (
    <div className="cbz">
      <ZoomableImage src={src} alt={label}>
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.previousPage")}
          aria-label={t("viewer.previousPage")}
          disabled={page <= 0}
          onClick={() => goTo(page - 1)}
        >
          &#8249;
        </button>
        <span className="cbz-count">{label}</span>
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.nextPage")}
          aria-label={t("viewer.nextPage")}
          disabled={page >= count - 1}
          onClick={() => goTo(page + 1)}
        >
          &#8250;
        </button>
      </ZoomableImage>
    </div>
  );
}
