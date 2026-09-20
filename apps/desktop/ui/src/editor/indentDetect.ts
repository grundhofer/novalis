/**
 * The indent unit a file already uses (PLAN.md §4.2, "indentation detected
 * per file"), from its first lines: tabs when more indented lines start with
 * a tab than with spaces; otherwise the most common positive step between
 * consecutive space-indented lines, two or four. Null when the file gives
 * too little away to overrule the preset — fewer than four indented lines,
 * or no step of two or four at all.
 */

const LINES = 200;
const MIN_INDENTED = 4;

export function detectIndent(text: string): "  " | "    " | "\t" | null {
  let tabs = 0;
  let spaced = 0;
  let twos = 0;
  let fours = 0;
  let previous = 0;
  let from = 0;
  for (let n = 0; n < LINES && from <= text.length; n += 1) {
    let to = text.indexOf("\n", from);
    if (to < 0) to = text.length;
    const line = text.slice(from, to);
    from = to + 1;
    if (line.trim() === "") continue;
    if (line.startsWith("\t")) {
      tabs += 1;
      continue;
    }
    let spaces = 0;
    while (line.charCodeAt(spaces) === 32) spaces += 1;
    if (spaces > 0) spaced += 1;
    const step = spaces - previous;
    if (step === 2) twos += 1;
    else if (step === 4) fours += 1;
    previous = spaces;
  }
  if (tabs + spaced < MIN_INDENTED) return null;
  if (tabs > spaced) return "\t";
  if (twos === 0 && fours === 0) return null;
  return fours > twos ? "    " : "  ";
}
