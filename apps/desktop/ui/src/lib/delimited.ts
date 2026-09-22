/**
 * CSV and TSV as rows of cells, for the read-only table behind the eye glyph
 * (ADR-0025). The text buffer stays the truth: nothing here writes.
 *
 * CSV follows RFC 4180 — a field in double quotes may hold commas, line
 * breaks and doubled quotes — and is lenient where files are not: LF or
 * CRLF, a quote in the middle of an unquoted field kept as written, a
 * missing closing quote read to the end. TSV has no quoting at all
 * (IANA's `text/tab-separated-values`): a line is a row, a tab ends a cell.
 * A final line break does not make an empty last row, and a byte-order mark
 * is not part of the first cell.
 */

function lines(text: string): string[] {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  if (body === "") return [];
  const out = body.split(/\r?\n/);
  if (out.at(-1) === "") out.pop();
  return out;
}

export function parseTsv(text: string): string[][] {
  return lines(text).map((line) => line.split("\t"));
}

export function parseCsv(text: string): string[][] {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  while (i < body.length) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else cell += c;
      i += 1;
      continue;
    }
    if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (c === "\r" && body[i + 1] === "\n") i += 1;
    } else {
      cell += c;
    }
    i += 1;
  }
  // The last line, unless the text ended with its line break.
  if (cell !== "" || row.length > 0 || quoted) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
