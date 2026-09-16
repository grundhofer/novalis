/**
 * Writing a mark into the source from the preview (ADR-0020, amended
 * 2026-09-16). The preview shows rendered text; the note is the source. The
 * renderer tags every paragraph, heading and list item with the span of its
 * source (`data-pos`, UTF-16 units of the whole note), so a selection inside
 * one block can be looked up there: the selected text is searched in the
 * block's source, and when it occurs exactly once the marker goes around
 * that occurrence — or comes off it, when it is already there, the way the
 * editor's `Cmd+B` toggles. Anything else (a selection over two blocks, text
 * that the markup splits, an ambiguous match) is `null`, and the caller
 * hands the user the editor instead of guessing.
 */

export interface BlockSpan {
  start: number;
  end: number;
}

/** `"12-34"` → `{ start: 12, end: 34 }`, or `null` for anything else. */
export function parseBlockSpan(attribute: string | null | undefined): BlockSpan | null {
  if (!attribute) return null;
  const match = /^(\d+)-(\d+)$/.exec(attribute);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end >= start ? { start, end } : null;
}

export type Marker = "**" | "_";

/**
 * The note text with `marker` toggled around `selected` inside `block`, or
 * `null` when the selection cannot be placed. Whitespace at the selection's
 * ends stays outside the marker, as a hand-typed `**word**` would have it.
 */
export function toggleMarkInSource(
  text: string,
  block: BlockSpan,
  selected: string,
  marker: Marker,
): string | null {
  const trimmed = selected.trim();
  if (!trimmed || block.end > text.length) return null;
  const source = text.slice(block.start, block.end);
  const first = source.indexOf(trimmed);
  if (first < 0 || source.indexOf(trimmed, first + 1) >= 0) return null;
  const from = block.start + first;
  const to = from + trimmed.length;
  const width = marker.length;
  const before = text.slice(Math.max(block.start, from - width), from);
  const after = text.slice(to, Math.min(block.end, to + width));
  if (before === marker && after === marker) {
    return text.slice(0, from - width) + trimmed + text.slice(to + width);
  }
  return `${text.slice(0, from)}${marker}${trimmed}${marker}${text.slice(to)}`;
}
