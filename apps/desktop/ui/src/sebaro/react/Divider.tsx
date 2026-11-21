// Divider.tsx: the line between a side pane and the content. It is the layer line, and the handle of the pane's
// width.
import { useRef, type PointerEvent } from "react";
import { COLLAPSE_AT, clamp, keyWidth, type Limits } from "./panes";

type Props = {
  /** the id of the pane this line belongs to */
  controls: string;
  label: string;
  /** the width in words, as a screen reader says it: „240 Pixel“, or „zugeklappt“ while the pane is hidden */
  valueText: string;
  /** the pane stands after the content: dragging towards the start widens it */
  atEnd?: boolean;
  /** the pane is shown */
  open: boolean;
  width: number;
  limits: Limits;
  onWidth(width: number): void;
  onOpen(open: boolean): void;
};

/** Dragging sets the width inside the limits; dragging well under the least width closes the pane. By keyboard: the
 *  arrows step, Home and End jump, Enter closes and opens. A double click gives back the start width. */
export function Divider({ controls, label, valueText, atEnd, open, width, limits, onWidth, onOpen }: Props) {
  const drag = useRef<{ x: number; from: number } | null>(null);
  const grow = atEnd ? -1 : 1;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, from: open ? width : 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    // while dragging the pointer keeps its shape and selects no text (the copy's stylesheet)
    document.documentElement.dataset.sbDragging = "resize";
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag.current) return;
    const wanted = drag.current.from + grow * (event.clientX - drag.current.x);
    if (wanted < limits.min - COLLAPSE_AT) return onOpen(false);
    if (!open) onOpen(true);
    onWidth(clamp(wanted, limits));
  };
  const onPointerUp = () => {
    drag.current = null;
    delete document.documentElement.dataset.sbDragging;
  };

  return (
    <div
      className="sb-window__divider"
      role="separator"
      aria-orientation="vertical"
      aria-controls={controls}
      aria-label={label}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={open ? width : limits.min}
      aria-valuetext={valueText}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        onOpen(true);
        onWidth(limits.start);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(!open);
        else {
          const next = keyWidth(event.key, event.shiftKey, open ? width : limits.min, limits, grow);
          if (next === null) return;
          onOpen(true);
          onWidth(next);
        }
        event.preventDefault();
      }}
    />
  );
}
