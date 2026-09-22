import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

/**
 * The table of contents that hangs under a reader's bar: the EPUB reader's
 * chapters (ADR-0023) and a PDF's outline (ADR-0025). A row is a place the
 * reader can go; the one it is in is marked.
 *
 * Escape closes it, and so does a click anywhere else — the toggle excepted,
 * which would otherwise close it on the way down and open it again on the
 * way up.
 */

export interface ContentsRow {
  readonly label: string;
  /** Nesting level, 0 at the top; a flat list leaves it out. */
  readonly depth?: number;
}

export default function ContentsPopover({
  label,
  rows,
  current,
  toggle,
  onPick,
  onClose,
}: {
  label: string;
  rows: readonly ContentsRow[];
  /** The index of the row the reader is in, or -1. */
  current: number;
  toggle: RefObject<HTMLButtonElement | null>;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const popover = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (popover.current?.contains(target) || toggle.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose, toggle]);

  return (
    <nav className="contents" ref={popover} aria-label={label}>
      <ul className="contents-list">
        {rows.map((row, index) => (
          <li key={index}>
            <button
              className={index === current ? "contents-row on" : "contents-row"}
              style={row.depth ? ({ "--depth": row.depth } as CSSProperties) : undefined}
              type="button"
              onClick={() => onPick(index)}
            >
              {row.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
