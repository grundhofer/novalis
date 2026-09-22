import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, type CSSProperties } from "react";

import { parseCsv, parseTsv } from "../lib/delimited";
import { useEditorSave } from "../stores/editorSave";
import "../styles/preview.css";

/**
 * A CSV or TSV as a table (`Cmd+E` / the eye glyph, ADR-0025): the first row
 * is the header and stays in view, the rows below are virtualized, so a file
 * of a hundred thousand lines costs a screenful of nodes. Read-only — no
 * cell editing, no sorting, no formulas (PLAN.md §7.3 "not a table
 * editor"); it renders the buffer, not the disk, so an unsaved edit shows,
 * and the editor is one `Cmd+E` away.
 */

const ROW_HEIGHT = 28;
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
    return { count: most, columns: widths.map((width) => `${width}ch`).join(" ") };
  }, [rows]);

  const scroller = useRef<HTMLElement | null>(null);
  const virtualizer = useVirtualizer({
    count: body,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

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
    <section className="table-preview" ref={scroller}>
      <div className="table-inner" role="table" aria-rowcount={rows.length}>
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
