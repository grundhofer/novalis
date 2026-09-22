import { EditorState, type Extension } from "@codemirror/state";

/**
 * The file's own line endings survive an edit (PLAN.md §5.5 "line endings
 * preserved", §2.3 rule 3 "never rewrite untouched bytes"). CodeMirror splits
 * on any line break and joins with `\n`, so without this the first keystroke
 * in a note written on Windows rewrote every line ending of it.
 *
 * A file whose every break is CRLF keeps CRLF, and a new line typed into it
 * is CRLF too. A file that mixes both is read the default way — a lone `\n`
 * inside a CRLF line would otherwise show as a character in the text — and
 * so still comes back as `\n` throughout once edited.
 */
export function lineBreakOf(text: string): "\r\n" | "\n" {
  if (!text.includes("\r\n")) return "\n";
  // Any break that is not part of a CRLF pair: a lone `\n` or a lone `\r`.
  return /(^|[^\r])\n|\r(?!\n)/.test(text) ? "\n" : "\r\n";
}

export function lineSeparatorFor(text: string): Extension[] {
  return lineBreakOf(text) === "\r\n" ? [EditorState.lineSeparator.of("\r\n")] : [];
}
