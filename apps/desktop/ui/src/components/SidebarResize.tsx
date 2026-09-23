import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { useUi } from "../stores/ui";

/** The token bounds of the sidebar (`--ds-size-sidebar-min/max`), in px. */
function bounds(): [number, number] {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: number) => parseFloat(style.getPropertyValue(name)) || fallback;
  return [read("--ds-size-sidebar-min", 180), read("--ds-size-sidebar-max", 480)];
}

const clamp = (width: number) => {
  const [min, max] = bounds();
  return Math.min(max, Math.max(min, width));
};

/**
 * The sidebar's right edge, dragged to set its width (a defect by the
 * 2026-09-20 record: `sidebarWidth` was kept in `state.json` and nothing
 * could change it). Arrow keys move it too when it has focus. The width is
 * the tokens' range, and it is disposable state, not a setting (ADR-0012).
 */
export default function SidebarResize() {
  const { t } = useTranslation();
  const width = useUi((s) => s.sidebarWidth);
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    // Captured, so the drag keeps going over the editor and past the window.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = { x: event.clientX, width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    useUi.getState().setSidebarWidth(clamp(start.current.width + event.clientX - start.current.x));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    start.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
    if (!step) return;
    event.preventDefault();
    useUi.getState().setSidebarWidth(clamp(width + step));
  };

  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("sidebar.resize")}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
