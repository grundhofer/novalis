import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, NovalisError, unwrap } from "../ipc/client";
import { mimeOf } from "../lib/fileTypes";
import { extensionOf, fileNameOf } from "../lib/paths";
import { report } from "../stores/ui";
import { Callout } from "./Banner";
import Tool from "./Tool";
import Waiting from "./Waiting";
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

/**
 * Where the reader stopped when a comic will not open, what it says, and in
 * which of sebaro's callouts (STA-05): a comic it could not read is an
 * error, one it may not open a warning, one without pages a note.
 */
const REFUSALS = {
  protected: { key: "viewer.cbz.protected", kind: "warning" },
  unreadable: { key: "viewer.cbz.unreadable", kind: "error" },
  empty: { key: "viewer.cbz.empty", kind: "note" },
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
  // The tools' tooltips need ids unique in the page.
  const uid = useId();
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
        // A protected archive is not a failure to report: the callout says
        // what it is. Anything else is, and the callout says only that much.
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
        <Callout kind={REFUSALS[refusal].kind} text={t(REFUSALS[refusal].key)} />
      </div>
    );
  }
  // A listing of the archive: silent while local, named after a second
  // while a cloud-only comic downloads (STA-06, ADR-0051 #27.8).
  if (!pages) return <Waiting path={path} />;

  const count = pages.length;
  const label = t("viewer.cbz.pageOf", { current: page + 1, count });
  const goTo = (next: number) => setPage(Math.min(count - 1, Math.max(0, next)));

  return (
    <div className="cbz">
      <ZoomableImage src={src} alt={label}>
        <Tool
          id={`${uid}-previous`}
          icon="chevron-left"
          label={t("viewer.previousPage")}
          disabled={page <= 0}
          onClick={() => goTo(page - 1)}
        />
        <span className="sb-doc-bar__count">{label}</span>
        <Tool
          id={`${uid}-next`}
          icon="chevron-right"
          label={t("viewer.nextPage")}
          disabled={page >= count - 1}
          onClick={() => goTo(page + 1)}
        />
      </ZoomableImage>
    </div>
  );
}
