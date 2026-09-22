/**
 * Where a query matches a line of text, as `[from, to)` ranges, for the
 * `<mark>`s of the search results and quick-open (PLAN.md §4.3). The core
 * sends the line, not the span, and the panel knows its own query.
 */
export type Range = readonly [number, number];

/** Every occurrence of a literal query. */
export function literalRanges(text: string, query: string, caseSensitive: boolean): Range[] {
  if (query === "") return [];
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Range[] = [];
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    out.push([at, at + needle.length]);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return out;
}

/**
 * Every match of a pattern. The core runs Rust's regex syntax and this runs
 * JavaScript's; where they differ, or the pattern does not compile here,
 * the line is shown unmarked rather than marked wrong.
 */
export function regexRanges(text: string, pattern: string, caseSensitive: boolean): Range[] {
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    return [];
  }
  const out: Range[] = [];
  for (const match of text.matchAll(expression)) {
    const from = match.index;
    if (match[0].length > 0) out.push([from, from + match[0].length]);
  }
  return out;
}

/** Fuzzy positions (`lib/fuzzy.ts`) merged into runs. */
export function positionRanges(positions: readonly number[]): Range[] {
  const out: [number, number][] = [];
  for (const at of positions) {
    const last = out.at(-1);
    if (last && last[1] === at) last[1] = at + 1;
    else out.push([at, at + 1]);
  }
  return out;
}
