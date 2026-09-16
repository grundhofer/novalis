/**
 * Headings for the `[[note#heading]]` form of a wikilink (PLAN.md §7.2,
 * decided 2026-09-16): once the `#` is typed inside `[[…]]`, the headings of
 * the named note are offered — of the note being edited when nothing stands
 * before the `#`. Pure text work; `setup.ts` binds it to CodeMirror.
 */

export interface HeadingLink {
  /** The note named before the `#`, as written; empty for this note. */
  target: string;
  /** What is typed after the `#` so far. */
  typed: string;
  /** Where the heading text starts: the offset just past the `#`. */
  from: number;
}

/**
 * Read `[[target#typed` off the end of `before` (the text left of the
 * cursor), or `null` when the cursor is not inside such a link. A `|label`
 * or a second `#` ends the form — nothing to complete there.
 */
export function parseHeadingLink(before: string): HeadingLink | null {
  const match = /\[\[([^[\]#|]*)#([^[\]#|]*)$/.exec(before);
  if (!match) return null;
  return {
    target: match[1]!,
    typed: match[2]!,
    from: match.index + 2 + match[1]!.length + 1,
  };
}

/**
 * The `#`-headings of a note, top to bottom, without their marks — the
 * text `[[note#…]]` names them by. The same scan the palette's heading
 * jump uses; a fenced `#` counts there too and so it does here.
 */
export function headingsOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^#{1,6}\s+(.*\S)/.exec(line);
    if (match) out.push(match[1]!);
  }
  return out;
}
