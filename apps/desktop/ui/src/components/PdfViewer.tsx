import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { chordOf, commandForChord } from "../lib/keymap";
import { currentRow, outlineOf, type OutlineRow } from "../lib/pdfOutline";
import { report } from "../stores/ui";
import ContentsPopover from "./ContentsPopover";

/**
 * The PDF pane (ADR-0016): pdf.js draws one page onto a canvas and lays its
 * text over it for selection, and the bar above is ours — previous, next,
 * page N of M, zoom, fit to width. The same on every platform's WebView,
 * which the WebView's own PDF view (macOS only, no controls) was not.
 *
 * ADR-0025 added the document's outline, in the popover the EPUB reader
 * uses for its contents, and the `viewer` rows of docs/KEYMAP.md: while the
 * pane has focus — it takes it when it opens, and a click on the page gives
 * it back — the arrows, PageUp/PageDown and Home/End turn the page.
 *
 * pdf.js runs its parser in a worker; the worker file is bundled as an asset
 * and loaded from the app itself, so the CSP stays at `script-src 'self'`.
 */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Zoom = "width" | number;

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;

/** Where each `viewer` command of docs/KEYMAP.md goes from `page` of `count`. */
const PAGE_KEYS: Readonly<Record<string, (page: number, count: number) => number>> = {
  "viewer.previousPage": (page) => page - 1,
  "viewer.nextPage": (page) => page + 1,
  "viewer.pageUp": (page) => page - 1,
  "viewer.pageDown": (page) => page + 1,
  "viewer.firstPage": () => 1,
  "viewer.lastPage": (_, count) => count,
};

export default function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<Zoom>("width");
  const [scale, setScale] = useState(1);
  const [outline, setOutline] = useState<readonly OutlineRow[]>([]);
  const [contentsOpen, setContentsOpen] = useState(false);
  const pane = useRef<HTMLElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const textLayer = useRef<HTMLDivElement | null>(null);

  // The document: parsed once per file, destroyed with the tab.
  useEffect(() => {
    let cancelled = false;
    // pdf.js takes ownership of the buffer it is given (it moves to the
    // worker), so it gets its own copy and the caller keeps the bytes.
    const task = pdfjs.getDocument({ data: bytes.slice() });
    task.promise
      .then((loaded) => {
        // A cancelled load is destroyed by the cleanup below.
        if (cancelled) return;
        setDoc(loaded);
        setPage(1);
        setOutline([]);
        setContentsOpen(false);
        // The outline comes after the first page: it is a convenience, and
        // resolving a long one is hundreds of round trips to the worker.
        outlineOf(loaded, loaded.numPages)
          .then((rows) => {
            if (!cancelled) setOutline(rows);
          })
          .catch(report);
      })
      .catch((error: unknown) => {
        // Destroying the task rejects its promise ("Loading aborted"): that
        // is the tab closing while the file was still parsing, not a failure.
        if (!cancelled) report(error);
      });
    return () => {
      cancelled = true;
      task.destroy().catch(report);
    };
  }, [bytes]);

  // The keys are the pane's while it has focus, so it takes focus when it
  // opens, as the editor does for a note.
  useEffect(() => {
    pane.current?.focus({ preventScroll: true });
  }, []);

  // One page: the canvas at device resolution, the text layer over it.
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    let render: pdfjs.RenderTask | null = null;
    doc
      .getPage(page)
      .then(async (current) => {
        const surface = canvas.current;
        const text = textLayer.current;
        const host = scroller.current;
        if (cancelled || !surface || !text || !host) return;
        const base = current.getViewport({ scale: 1 });
        const fit = zoom === "width" ? Math.max(ZOOM_MIN, (host.clientWidth - 32) / base.width) : zoom;
        setScale(fit);
        const viewport = current.getViewport({ scale: fit });
        const dpr = window.devicePixelRatio || 1;
        surface.width = Math.floor(viewport.width * dpr);
        surface.height = Math.floor(viewport.height * dpr);
        surface.style.width = `${Math.floor(viewport.width)}px`;
        surface.style.height = `${Math.floor(viewport.height)}px`;
        render = current.render({ canvas: surface, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
        await render.promise;
        if (cancelled) return;
        text.replaceChildren();
        // The stream, not `getTextContent()`: that one iterates the stream
        // with `for await`, which this WebView's ReadableStream does not
        // support, and the text layer reads a stream with `getReader()`.
        await new pdfjs.TextLayer({
          textContentSource: current.streamTextContent(),
          container: text,
          viewport,
        }).render();
      })
      .catch((error: unknown) => {
        // Cancelling a render rejects its promise; that is the cleanup
        // below, not a failure.
        if (!(error instanceof Error && error.name === "RenderingCancelledException")) report(error);
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, page, zoom]);

  const count = doc?.numPages ?? 0;
  const goTo = (next: number) => {
    if (count === 0) return;
    setPage(Math.min(count, Math.max(1, next)));
  };
  const zoomBy = (factor: number) =>
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor)));
  const closeContents = useCallback(() => setContentsOpen(false), []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // The page field keeps its own arrows and Home/End.
    if (event.target instanceof HTMLInputElement) return;
    const chord = chordOf(event.nativeEvent);
    const binding = chord ? commandForChord(chord) : undefined;
    const move = binding?.scope === "viewer" ? PAGE_KEYS[binding.command] : undefined;
    if (!move) return;
    // Taken even on the first or last page: PageDown would otherwise scroll
    // the pane, and the key would do two different things.
    event.preventDefault();
    goTo(move(page, count));
  };

  return (
    <section className="pdf" ref={pane} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="pdf-bar">
        {outline.length > 0 && (
          <button
            className={contentsOpen ? "btn ghost pdf-tool wide on" : "btn ghost pdf-tool wide"}
            type="button"
            ref={toggle}
            aria-expanded={contentsOpen}
            onClick={() => setContentsOpen((open) => !open)}
          >
            {t("viewer.outline")}
          </button>
        )}
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.previousPage")}
          aria-label={t("viewer.previousPage")}
          disabled={page <= 1}
          onClick={() => goTo(page - 1)}
        >
          &#8249;
        </button>
        <input
          className="pdf-page"
          type="number"
          min={1}
          max={Math.max(1, count)}
          value={page}
          aria-label={t("viewer.page")}
          onChange={(event) => goTo(Number(event.target.value))}
        />
        <span className="pdf-count">{t("viewer.pageOf", { count })}</span>
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.nextPage")}
          aria-label={t("viewer.nextPage")}
          disabled={page >= count}
          onClick={() => goTo(page + 1)}
        >
          &#8250;
        </button>
        <span className="pdf-spacer" />
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.zoomOut")}
          aria-label={t("viewer.zoomOut")}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          &#8722;
        </button>
        <span className="pdf-zoom">{t("viewer.zoom", { percent: Math.round(scale * 100) })}</span>
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.zoomIn")}
          aria-label={t("viewer.zoomIn")}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          +
        </button>
        <button
          className={zoom === "width" ? "btn ghost pdf-tool wide on" : "btn ghost pdf-tool wide"}
          type="button"
          aria-pressed={zoom === "width"}
          onClick={() => setZoom("width")}
        >
          {t("viewer.fitWidth")}
        </button>
      </header>
      {contentsOpen && (
        <ContentsPopover
          label={t("viewer.outline")}
          rows={outline}
          current={currentRow(outline, page)}
          toggle={toggle}
          onPick={(index) => {
            setContentsOpen(false);
            goTo(outline[index]?.page ?? page);
            pane.current?.focus({ preventScroll: true });
          }}
          onClose={closeContents}
        />
      )}
      <div className="pdf-scroll" ref={scroller}>
        <div className="pdf-sheet" style={{ "--total-scale-factor": scale } as React.CSSProperties}>
          <canvas className="pdf-canvas" ref={canvas} />
          <div className="textLayer" ref={textLayer} />
        </div>
      </div>
    </section>
  );
}
