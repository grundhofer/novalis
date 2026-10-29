import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { parseCsv, parseTsv } from "../lib/delimited";
import { fileNameOf } from "../lib/paths";
import { tableRowHeight } from "../lib/windowRow";
import { useEditorSave } from "../stores/editorSave";
import "../styles/preview.css";

/**
 * A CSV or TSV as a table (`Cmd+E` / the preview switch, ADR-0025): the first row
 * is the header and stays in view, the rows below are virtualized, so a file
 * of a hundred thousand lines costs a screenful of nodes. Read-only — no
 * cell editing, no sorting, no formulas (PLAN.md §7.3 "not a table
 * editor"); it renders the buffer, not the disk, so an unsaved edit shows,
 * and the editor is one `Cmd+E` away.
 *
 * It looks like sebaro's table (`div.sb-table[role=table]`, spec/02 §3.9,
 * DAT-05): heads in `label` over the `border-strong` line, rows on
 * hairlines, no vertical lines, no fill, figures in table width (SCH-03).
 * A cell stays one line, its full value in `title` (ADR-0051 #24); the row
 * height grows with the root font (`tableRowHeight`, ZUG-09), as the tree's
 * does. The pane is the table's scrolling region, reached by keyboard.
 */

const MIN_CH = 4;
const MAX_CH = 40;

export default function TablePreview({ path, kind }: { path: string; kind: "csv" | "tsv" }) {
  const text = useEditorSave((s) => s.docs[path]?.text ?? "");
  const rows = useMemo(() => (kind === "csv" ? parseCsv(text) : parseTsv(text)), [kind, text]);
  const header = rows[0] ?? [];
  const body = rows.length > 1 ? rows.length - 1 : 0;

  // One grid template for every row, so the columns line up although each
  // row is its own element: the widest cell of the column, in `ch` plus the
  // cell's padding, clamped. Every row is measured — a sample would cut the
  // ids past its end — which is one pass more over what was just parsed.
  const { count, columns } = useMemo(() => {
    const most = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
    const widths = Array.from({ length: most }, () => MIN_CH);
    for (const row of rows) {
      row.forEach((cell, index) => {
        widths[index] = Math.min(MAX_CH, Math.max(widths[index] ?? MIN_CH, cell.length + 3));
      });
    }
    // The last column takes the rest of the width, so the lines under the
    // rows reach the pane's end as a full-width table's do.
    const tracks = widths.map((width, index) =>
      index === widths.length - 1 ? `minmax(${width}ch, 1fr)` : `${width}ch`,
    );
    return { count: most, columns: tracks.join(" ") };
  }, [rows]);

  const scroller = useRef<HTMLElement | null>(null);
  /** One row at the root font in use, measured again when it changes. */
  const [rowHeight, setRowHeight] = useState(tableRowHeight);
  /** An unseen line whose height follows the root font. */
  const probe = useRef<HTMLSpanElement | null>(null);
  const virtualizer = useVirtualizer({
    count: body,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // The root font changed (large text, ZUG-09): the probe's height did too,
  // so the rows take the new height while the table stays open.
  useEffect(() => {
    const element = probe.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setRowHeight(tableRowHeight()));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Rows drawn at the old height are placed again at the new one.
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const grid = { gridTemplateColumns: columns } as CSSProperties;
  // A short row is padded to the widest one; a cell cut by its column
  // shows in full as its tooltip.
  const cells = (row: readonly string[], role: "cell" | "columnheader") =>
    Array.from({ length: count }, (_, index) => (
      <span className="table-cell" role={role} key={index} title={row[index]}>
        {row[index] ?? ""}
      </span>
    ));

  return (
    <section
      className="table-preview"
      ref={scroller}
      role="region"
      aria-label={fileNameOf(path)}
      tabIndex={0}
    >
      <span className="table-probe" ref={probe} aria-hidden="true">
        {"\u00a0"}
      </span>
      <div className="table-inner sb-table" role="table" aria-rowcount={rows.length} data-sb-truncate="">
        <div className="table-head" role="row" style={grid}>
          {cells(header, "columnheader")}
        </div>
        <div className="table-body" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              className="table-row"
              role="row"
              key={item.key}
              style={{ ...grid, height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
            >
              {cells(rows[item.index + 1] ?? [], "cell")}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
