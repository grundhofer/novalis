import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * An image with zoom (ADR-0025), for the image viewer and the comic reader:
 * the bar's − / % / + / fit, a pinch on the trackpad or a `Ctrl`-wheel, and
 * a click that toggles between fitting the pane and 1:1. A plain wheel
 * scrolls, as in every other pane. `Cmd+=` / `Cmd+-` / `Cmd+0` are not
 * claimed: they stay the global font-size chords (ADR-0004/0008).
 *
 * The image is always sized by its natural size times the scale, so fitting
 * is only a scale computed from the pane — never upscaled past 1:1 — and a
 * zoom keeps the point under the pointer where it was.
 *
 * The bar is this component's; `children` are what a reader puts on its
 * left (the comic's page controls).
 */

type Zoom = "fit" | number;

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;

const clamp = (scale: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));

/** Where a zoom was aimed: a point on screen, as a fraction of the image. */
interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly fx: number;
  readonly fy: number;
}

/** WebKit's trackpad pinch, which arrives as its own event and not as a wheel. */
interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

export default function ZoomableImage({
  src,
  alt,
  children,
}: {
  src: string | null;
  alt: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const anchor = useRef<Anchor | null>(null);

  // The room the image may fill: the pane less the sheet's padding.
  useEffect(() => {
    const pane = scroller.current;
    const inner = sheet.current;
    if (!pane || !inner) return undefined;
    const measure = () => {
      const style = getComputedStyle(inner);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) || 0;
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
      setRoom({ width: pane.clientWidth - padX, height: pane.clientHeight - padY });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const fit =
    natural && room && room.width > 0 && room.height > 0
      ? Math.min(1, room.width / natural.width, room.height / natural.height)
      : 1;
  const scale = zoom === "fit" ? fit : zoom;

  /** Zoom to `next`, keeping the point at `x`,`y` (the pane's centre by default) in place. */
  const zoomTo = (next: Zoom, x?: number, y?: number) => {
    const rect = image.current?.getBoundingClientRect();
    const pane = scroller.current?.getBoundingClientRect();
    // No change of size, no layout to wait for: an anchor left here would be
    // applied to whatever zoom comes next.
    const changes = (next === "fit" ? fit : next) !== scale;
    if (changes && rect && pane && rect.width > 0 && rect.height > 0) {
      const px = x ?? pane.left + pane.width / 2;
      const py = y ?? pane.top + pane.height / 2;
      anchor.current = { x: px, y: py, fx: (px - rect.left) / rect.width, fy: (py - rect.top) / rect.height };
    }
    setZoom(next);
  };

  // After the new size is laid out, scroll so the aimed-at point is back
  // under the pointer.
  useLayoutEffect(() => {
    const aim = anchor.current;
    anchor.current = null;
    const rect = image.current?.getBoundingClientRect();
    const pane = scroller.current;
    if (!aim || !rect || !pane) return;
    pane.scrollLeft += rect.left + aim.fx * rect.width - aim.x;
    pane.scrollTop += rect.top + aim.fy * rect.height - aim.y;
  }, [scale]);

  // Another page starts at its top left, at the same zoom.
  useEffect(() => {
    scroller.current?.scrollTo?.({ left: 0, top: 0 });
  }, [src]);

  // A pinch and a `Ctrl`-wheel zoom; the listeners are the DOM's own because
  // React's wheel listener is passive and could not keep the page from
  // scrolling. The latest scale is read through a ref, not captured.
  const current = useRef({ scale, zoomTo });
  useLayoutEffect(() => {
    current.current = { scale, zoomTo };
  });
  useEffect(() => {
    const pane = scroller.current;
    if (!pane) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      // A mouse wheel notch is ±100, a pinch step a few units: both are
      // capped so one notch is one bar step at most.
      const delta = Math.max(-25, Math.min(25, event.deltaY));
      const { scale: now, zoomTo: to } = current.current;
      to(clamp(now * Math.exp(-delta / 100)), event.clientX, event.clientY);
    };
    let start = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      start = current.current.scale;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEvent;
      current.current.zoomTo(clamp(start * gesture.scale), gesture.clientX, gesture.clientY);
    };
    pane.addEventListener("wheel", onWheel, { passive: false });
    pane.addEventListener("gesturestart", onGestureStart);
    pane.addEventListener("gesturechange", onGestureChange);
    return () => {
      pane.removeEventListener("wheel", onWheel);
      pane.removeEventListener("gesturestart", onGestureStart);
      pane.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const onClick = (event: ReactMouseEvent<HTMLImageElement>) =>
    zoomTo(zoom === "fit" ? 1 : "fit", event.clientX, event.clientY);

  return (
    <div className="zoom">
      <header className="zoom-bar">
        {children}
        <span className="pdf-spacer" />
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.zoomOut")}
          aria-label={t("viewer.zoomOut")}
          onClick={() => zoomTo(clamp(scale / ZOOM_STEP))}
        >
          &#8722;
        </button>
        <span className="pdf-zoom">{t("viewer.zoom", { percent: Math.round(scale * 100) })}</span>
        <button
          className="btn ghost pdf-tool"
          type="button"
          title={t("viewer.zoomIn")}
          aria-label={t("viewer.zoomIn")}
          onClick={() => zoomTo(clamp(scale * ZOOM_STEP))}
        >
          +
        </button>
        <button
          className={zoom === "fit" ? "btn ghost pdf-tool wide on" : "btn ghost pdf-tool wide"}
          type="button"
          aria-pressed={zoom === "fit"}
          onClick={() => zoomTo("fit")}
        >
          {t("viewer.fit")}
        </button>
      </header>
      <div className="zoom-scroll" ref={scroller}>
        <div className="zoom-sheet" ref={sheet}>
          {src && (
            <img
              className={zoom === "fit" ? "zoom-image" : "zoom-image zoomed"}
              ref={image}
              src={src}
              alt={alt}
              draggable={false}
              // Hidden until its size is known, so it never flashes at 1:1.
              style={
                natural
                  ? { width: natural.width * scale, height: natural.height * scale }
                  : { opacity: 0 }
              }
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onClick={onClick}
            />
          )}
        </div>
      </div>
    </div>
  );
}
