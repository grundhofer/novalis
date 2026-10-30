import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

/**
 * The table of contents that hangs under a reader's bar: the EPUB reader's
 * chapters (ADR-0023) and a PDF's outline (ADR-0025). A row is a place the
 * reader can go; the one it is in is the current place.
 *
 * sebaro's contents over a reader (`nav.sb-toc.sb-toc--overlay`, spec/02
 * §4.5, D102 (34)): `sb-toc` rows on the overlay surface of `sb-menu` (the
 * 2 px ink line, radius 12, no shadow; EBE-07), window rows of 32 px; the
 * current row carries `aria-current="location"`, which sebaro.css draws as
 * the 3 px place line with the link colour and the title weight (NAV-01). A
 * title wraps instead of ending in „…“ (ADR-0051 #24, ZUG-09); a nested
 * entry is indented by its depth. It hangs under the bar (styles/viewer.css),
 * not as a `[popover]`, and keeps its own keys: the focus stays at the
 * toggle when it opens.
 *
 * Escape closes it, and so does a click anywhere else — the toggle excepted,
 * which would otherwise close it on the way down and open it again on the
 * way up. Escape with the focus on a row hands the focus back to the toggle
 * before the rows go, so it does not fall to the page (spec/02 §4.10,
 * NAV-08); after a pick the reader places it.
 */

export interface ContentsRow {
  readonly label: string;
  /** Nesting level, 0 at the top; a flat list leaves it out. */
  readonly depth?: number;
}

export default function ContentsPopover({
  id,
  label,
  rows,
  current,
  toggle,
  onPick,
  onClose,
}: {
  /** What the toggle's `aria-controls` names. */
  id: string;
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
      if (event.key !== "Escape") return;
      if (popover.current?.contains(document.activeElement)) toggle.current?.focus();
      onClose();
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
    <nav
      className="sb-toc sb-toc--overlay viewer-contents"
      id={id}
      ref={popover}
      aria-label={label}
      data-sb-density="window"
    >
      <ol>
        {rows.map((row, index) => (
          <li key={index}>
            <a
              href={`#${id}-${index}`}
              style={row.depth ? ({ "--depth": row.depth } as CSSProperties) : undefined}
              aria-current={index === current ? "location" : undefined}
              onClick={(event) => {
                // A place in the reader, not in the page.
                event.preventDefault();
                onPick(index);
              }}
              onKeyDown={(event) => {
                // It was a button: Space still jumps, as Enter does.
                if (event.key !== " ") return;
                event.preventDefault();
                onPick(index);
              }}
            >
              {row.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
