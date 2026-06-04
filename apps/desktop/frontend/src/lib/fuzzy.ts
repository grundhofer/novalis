// Lightweight fuzzy subsequence matching, used to rank command-palette and
// search results. Greedy (first-occurrence) — good enough for short lists and
// keeps the scoring simple and predictable.

const BOUNDARY = /[\s\-_/.]/;

/** Returns a score (higher = better) when every character of `query` appears in
 *  `text` in order (case-insensitive), else null. Rewards consecutive matches,
 *  matches at the start, and matches just after a word boundary; slightly
 *  prefers shorter (denser) targets. An empty query scores 0 (matches all). */
export function fuzzyScore(text: string, query: string): number | null {
  if (query === "") return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at === -1) return null;
    let bonus = 1;
    if (at === prev + 1) bonus += 3; // consecutive
    if (at === 0) bonus += 4; // start of string
    else if (BOUNDARY.test(t[at - 1])) bonus += 2; // after a word boundary
    score += bonus;
    prev = at;
    from = at + 1;
  }
  return score - t.length * 0.01;
}

/** Filter + sort `items` by how well `key(item)` fuzzy-matches `query`. With an
 *  empty query the list is returned unchanged. */
export function fuzzyRank<T>(items: T[], query: string, key: (item: T) => string): T[] {
  if (query === "") return items;
  return items
    .map((item) => ({ item, score: fuzzyScore(key(item), query) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}
