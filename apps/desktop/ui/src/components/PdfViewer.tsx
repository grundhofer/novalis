import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { report } from "../stores/ui";

/**
 * The PDF pane (ADR-0016): pdf.js draws one page onto a canvas and lays its
 * text over it for selection, and the bar above is ours — previous, next,
 * page N of M, zoom, fit to width. The same on every platform's WebView,
 * which the WebView's own PDF view (macOS only, no controls) was not.
 *
 * pdf.js runs its parser in a worker; the worker file is bundled as an asset
 * and loaded from the app itself, so the CSP stays at `script-src 'self'`.
 */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type Zoom = "width" | number;

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;

export default function PdfViewer({ bytes }: { bytes: Uint8Array }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<Zoom>("width");
  const [scale, setScale] = useState(1);
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
      })
      .catch(report);
    return () => {
      cancelled = true;
      task.destroy().catch(report);
    };
  }, [bytes]);

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
        await new pdfjs.TextLayer({
          textContentSource: await current.getTextContent(),
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

  return (
    <section className="pdf">
      <header className="pdf-bar">
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
      <div className="pdf-scroll" ref={scroller}>
        <div className="pdf-sheet" style={{ "--total-scale-factor": scale } as React.CSSProperties}>
          <canvas className="pdf-canvas" ref={canvas} />
          <div className="textLayer" ref={textLayer} />
        </div>
      </div>
    </section>
  );
}
