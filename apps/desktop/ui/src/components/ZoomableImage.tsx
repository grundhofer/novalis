import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import Tool from "./Tool";

/**
 * An image with zoom (ADR-0025), for the image viewer and the comic reader:
 * the bar's tools (zoom out, the percentage, zoom in, „Einpassen“), a pinch
 * on the trackpad or a `Ctrl`-wheel, and a click that toggles between
 * fitting the pane and 1:1. A plain wheel scrolls, as in every other pane. `Cmd+Plus` / `Cmd+Minus` / `Cmd+0` are
 * not claimed: they stay the global font-size chords (ADR-0004/0008/0051).
 *
 * The image is always sized by its natural size times the scale, so fitting
 * is only a scale computed from the pane — never upscaled past 1:1 — and a
 * zoom keeps the point under the pointer where it was.
 *
 * The bar is this component's, sebaro's reader row (`sb-doc-bar`, spec/02
 * §4.25.3, D104 (5)–(7)): `children` are what a reader puts first (the
 * comic's page controls), then the divider and the zoom — `zoom-out`, the
 * value, `zoom-in`, `zoom-fit` for „Einpassen“ (`aria-pressed`). The image
 * stands on the sunken ground of `sb-reader__view`, which is a focus stop
 * named after the image, so it scrolls by keys too (spec/02 §4.25.3,
 * sebaro D108 NV-Y7).
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
  // The tools' tooltips need ids unique in the page.
  const uid = useId();
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const anchor = useRef<Anchor | null>(null);

  // The room the image may fill: the pane's content box, less its own
  // padding (`sb-reader__view` gives it space-4 on each side) and the
  // sheet's, so the fitted image leaves the view without a scrollbar
  // (spec/02 §4.25.3 LE-3; docs/sebaro-luecken.md Z).
  useEffect(() => {
    const pane = scroller.current;
    const inner = sheet.current;
    if (!pane || !inner) return undefined;
    const padding = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        x: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) || 0,
        y: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0,
      };
    };
    const measure = () => {
      const outer = padding(pane);
      const own = padding(inner);
      setRoom({ width: pane.clientWidth - outer.x - own.x, height: pane.clientHeight - outer.y - own.y });
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
      <div className="sb-doc-bar" role="group" aria-label={t("viewer.tools")}>
        {children}
        {children && <span className="sb-doc-bar__sep" aria-hidden="true" />}
        <div className="viewer-bar__group">
          <Tool
            id={`${uid}-zoom-out`}
            icon="zoom-out"
            label={t("viewer.zoomOut")}
            onClick={() => zoomTo(clamp(scale / ZOOM_STEP))}
          />
          <span className="sb-doc-bar__value" role="status">
            <span className="sb-visually-hidden">{t("viewer.zoomName")} </span>
            <span>{t("viewer.zoom", { percent: Math.round(scale * 100) })}</span>
          </span>
          <Tool
            id={`${uid}-zoom-in`}
            icon="zoom-in"
            label={t("viewer.zoomIn")}
            onClick={() => zoomTo(clamp(scale * ZOOM_STEP))}
          />
          <Tool
            id={`${uid}-fit`}
            icon="zoom-fit"
            label={t("viewer.fit")}
            pressed={zoom === "fit"}
            onClick={() => zoomTo("fit")}
          />
        </div>
      </div>
      <div className="zoom-scroll sb-reader__view" ref={scroller} tabIndex={0} role="region" aria-label={alt}>
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
