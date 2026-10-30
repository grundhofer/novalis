import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { SIDEBAR_WIDTH, sidebarShownWidth, useUi } from "../stores/ui";

/** Dragged this far under the smallest width, the sidebar collapses (spec/02 §4.23). */
const COLLAPSE_AT = 48;
/** The keyboard's steps, in px: an arrow, and an arrow with ⇧. */
const STEP = 8;
const STEP_BIG = 32;

/** Open or close the sidebar, if it is not already so. */
function open(visible: boolean): void {
  useUi.getState().setSidebarVisible(visible);
}

/**
 * A width for the sidebar from the keyboard, a double click or a drag: it
 * opens. Never wider than the window leaves beside the content's 480 px
 * (`sidebarRoom`, spec/02 §4.23, as `sb-window.js`'s `setWidth`); with no
 * room even for the smallest width it stays as it is.
 */
function widthTo(width: number): void {
  const room = useUi.getState().sidebarRoom;
  if (room !== null && room < SIDEBAR_WIDTH.min) return;
  useUi.getState().setSidebarWidth(room === null ? width : Math.min(width, room));
  open(true);
}

/**
 * The divider between the sidebar and the content (sebaro's
 * `sb-window__divider`, spec/02 §4.23, DSK-07, ADR-0051). It is the 2 px
 * ink layer line between them (the sidebar drops its own line beside it),
 * with a 24 px pointer target; only the pointer changes on hover, the
 * keyboard shows the focus ring (all sebaro.css). Dragged, it sets
 * the width between 200 and 360 px, and 48 px under the smallest width it
 * collapses the sidebar; dragged out again it opens. A double click gives
 * back the start width. Keys: ← → 8 px, with ⇧ 32 px, Home / End the
 * smallest / largest width, Enter collapses and restores. It stays while
 * the sidebar is hidden, at the window's edge, so it can bring it back.
 *
 * In a window too narrow for its width beside the content the sidebar gives
 * way (sebaro.css, lib/windowFit.ts): the divider then names and moves the
 * width that shows, and the sidebar's own width is kept for a wider window.
 *
 * The width is disposable state in `state.json`, not a setting (ADR-0012);
 * sebaro keeps it in localStorage, novalis where the rest of the window is
 * kept (docs/sebaro-umbau.md §6 B). While it is dragged,
 * `html[data-sb-dragging="resize"]` keeps the pointer's shape over the
 * content and stops text selection (sebaro.css, set as sb-window.js does).
 */
export default function SidebarResize() {
  const { t } = useTranslation();
  // What shows: less than the sidebar's own width while it gives way.
  const width = useUi(sidebarShownWidth);
  const visible = useUi((s) => s.sidebarVisible);
  const start = useRef<{ x: number; from: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // Captured, so the drag keeps going over the editor and past the window.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = { x: event.clientX, from: visible ? width : 0 };
    document.documentElement.dataset.sbDragging = "resize";
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const wanted = start.current.from + event.clientX - start.current.x;
    // The width is kept while collapsed: dragged out again, it opens there.
    if (wanted < SIDEBAR_WIDTH.min - COLLAPSE_AT) open(false);
    else widthTo(wanted);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    start.current = null;
    delete document.documentElement.dataset.sbDragging;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A collapsed sidebar counts as its smallest width, as `aria-valuenow` says.
    const now = visible ? width : SIDEBAR_WIDTH.min;
    const step = event.shiftKey ? STEP_BIG : STEP;
    switch (event.key) {
      case "ArrowLeft":
        widthTo(now - step);
        break;
      case "ArrowRight":
        widthTo(now + step);
        break;
      case "Home":
        widthTo(SIDEBAR_WIDTH.min);
        break;
      case "End":
        // The largest width that fits (spec/02 §4.23).
        widthTo(SIDEBAR_WIDTH.max);
        break;
      case "Enter":
        open(!visible);
        break;
      default:
        return;
    }
    event.preventDefault();
    // Kept from the window's keymap, where `Enter` is the tree's rename.
    event.stopPropagation();
  };

  return (
    <div
      className="sb-window__divider"
      role="separator"
      aria-orientation="vertical"
      // A hidden sidebar stays in the page with `hidden` (App, Sidebar).
      aria-controls="sidebar"
      aria-label={t("sidebar.resize")}
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={visible ? width : SIDEBAR_WIDTH.min}
      aria-valuetext={visible ? t("sidebar.widthValue", { width }) : t("sidebar.collapsed")}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => widthTo(SIDEBAR_WIDTH.start)}
      onKeyDown={onKeyDown}
    />
  );
}
