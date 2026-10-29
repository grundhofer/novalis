import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { focusInTabList } from "../lib/areas";
import { ariaKeyshortcutsOfScope, chordOf, commandForChord } from "../lib/keymap";
import { currentRow, outlineOf, type OutlineRow } from "../lib/pdfOutline";
import { report } from "../stores/ui";
import ContentsPopover from "./ContentsPopover";
import Tool from "./Tool";

/**
 * The PDF pane (ADR-0016): pdf.js draws one page onto a canvas and lays its
 * text over it for selection, and the bar above is ours — previous, next,
 * page N of M, zoom, fit to width. The same on every platform's WebView,
 * which the WebView's own PDF view (macOS only, no controls) was not.
 *
 * ADR-0025 added the document's outline, in the popover the EPUB reader
 * uses for its contents, and the `viewer` rows of docs/KEYMAP.md: while the
 * pane has focus — it takes it when it opens, and a click on the page gives
 * it back — the arrows, PageUp/PageDown and Home/End turn the page. The
 * pane is a region named after the file, and it announces those keys in
 * `aria-keyshortcuts`.
 *
 * The pane is sebaro's document reader (`sb-reader`, spec/02 §4.25.3,
 * D104 (5)–(7)): its tools in a row of their own over the document
 * (`sb-doc-bar`), first the page, then the zoom, wrapping at a large root
 * font; the page on the sunken ground of `sb-reader__view` in its 1 px
 * frame. The tools previous, next, zoom out, zoom in and „Seitenbreite“
 * are `sb-icon-button--compact` with their tooltips (`zoom-out`, `zoom-in`,
 * `zoom-fit`; „Seitenbreite“ `aria-pressed`), „Inhalt“ a compact secondary
 * action with `aria-expanded` (NAV-10), the page field sebaro's
 * `sb-field--number` „Seite [n] von m“ (EIN-01), the zoom value
 * `sb-doc-bar__value` in tabular figures (SCH-03), all in sebaro Sans
 * (SCH-01).
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

export default function PdfViewer({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const { t } = useTranslation();
  // The tools' tooltips and the page field's label need ids unique in the page.
  const uid = useId();
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<Zoom>("width");
  const [scale, setScale] = useState(1);
  const [outline, setOutline] = useState<readonly OutlineRow[]>([]);
  const [contentsOpen, setContentsOpen] = useState(false);
  // The width a page may take at „Seitenbreite“: the scroller less its
  // padding (in rem, so it grows with the root font) and the sheet's frame.
  const [room, setRoom] = useState(0);
  const pane = useRef<HTMLElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
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
  // opens, as the editor does for a note; not from the tab list that chose
  // it with the keys (spec/02 §4.21).
  useEffect(() => {
    if (!focusInTabList()) pane.current?.focus({ preventScroll: true });
  }, []);

  // The room, measured and measured again when the pane or the root font
  // changes (the padding shrinks the scroller's content box).
  useEffect(() => {
    const host = scroller.current;
    const frame = sheet.current;
    if (!host || !frame) return undefined;
    const px = (value: string) => parseFloat(value) || 0;
    const measure = () => {
      // A pane that is not shown keeps the room it had.
      if (host.clientWidth <= 0) return;
      const pad = getComputedStyle(host);
      const edge = getComputedStyle(frame);
      setRoom(
        host.clientWidth -
          px(pad.paddingLeft) -
          px(pad.paddingRight) -
          px(edge.borderLeftWidth) -
          px(edge.borderRightWidth),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  // Only fit to width follows the room; a set zoom stays where it is.
  const fitRoom = zoom === "width" ? room : null;

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
        if (cancelled || !surface || !text) return;
        const base = current.getViewport({ scale: 1 });
        const fit = zoom === "width" ? Math.max(ZOOM_MIN, (fitRoom ?? 0) / base.width) : zoom;
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
  }, [doc, page, zoom, fitRoom]);

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
    <section
      className="pdf sb-reader"
      ref={pane}
      tabIndex={-1}
      aria-label={name}
      aria-keyshortcuts={ariaKeyshortcutsOfScope("viewer")}
      data-sb-own-shortcut=""
      onKeyDown={onKeyDown}
    >
      <div className="viewer-head">
        <div className="sb-doc-bar" role="group" aria-label={t("viewer.tools")}>
          {outline.length > 0 && (
            <button
              className="sb-secondary-action sb-secondary-action--compact"
              type="button"
              ref={toggle}
              aria-expanded={contentsOpen}
              aria-controls={contentsOpen ? `${uid}-contents` : undefined}
              onClick={() => setContentsOpen((open) => !open)}
            >
              {t("viewer.outline")}
            </button>
          )}
          <Tool
            id={`${uid}-previous`}
            icon="chevron-left"
            label={t("viewer.previousPage")}
            command="viewer.previousPage"
            disabled={page <= 1}
            onClick={() => goTo(page - 1)}
          />
          <div className="sb-field sb-field--compact sb-field--number">
            <label className="sb-field__label" htmlFor={`${uid}-page`}>
              {t("viewer.page")}
            </label>
            <div className="sb-field__control">
              <input
                id={`${uid}-page`}
                type="number"
                min={1}
                max={Math.max(1, count)}
                value={page}
                onChange={(event) => goTo(Number(event.target.value))}
              />
              <span className="sb-field__suffix">{t("viewer.pageOf", { count })}</span>
            </div>
          </div>
          <Tool
            id={`${uid}-next`}
            icon="chevron-right"
            label={t("viewer.nextPage")}
            command="viewer.nextPage"
            disabled={page >= count}
            onClick={() => goTo(page + 1)}
          />
          <span className="sb-doc-bar__sep" aria-hidden="true" />
          <div className="viewer-bar__group">
            <Tool
              id={`${uid}-zoom-out`}
              icon="zoom-out"
              label={t("viewer.zoomOut")}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
            />
            <span className="sb-doc-bar__value" role="status">
              <span className="sb-visually-hidden">{t("viewer.zoomName")} </span>
              <span>{t("viewer.zoom", { percent: Math.round(scale * 100) })}</span>
            </span>
            <Tool id={`${uid}-zoom-in`} icon="zoom-in" label={t("viewer.zoomIn")} onClick={() => zoomBy(ZOOM_STEP)} />
            <Tool
              id={`${uid}-fit`}
              icon="zoom-fit"
              label={t("viewer.fitWidth")}
              pressed={zoom === "width"}
              onClick={() => setZoom("width")}
            />
          </div>
        </div>
        {contentsOpen && (
          <ContentsPopover
            id={`${uid}-contents`}
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
      </div>
      <div className="pdf-scroll sb-reader__view" ref={scroller}>
        <div className="pdf-sheet" ref={sheet} style={{ "--total-scale-factor": scale } as React.CSSProperties}>
          <canvas className="pdf-canvas" ref={canvas} />
          <div className="textLayer" ref={textLayer} />
        </div>
      </div>
    </section>
  );
}
