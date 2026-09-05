/**
 * The fuzzy matcher behind quick-open and the palette (PLAN.md §7.1:
 * "`nucleo`-class matcher").
 *
 * Subsequence matching with a score that rewards, in order: a match at a word
 * boundary, a run of consecutive characters, and a match near the start. Case
 * is ignored unless the query has an upper-case letter (smart case). Enough for
 * a 10k-note vault, and it runs on the strings the UI already holds.
 */

export interface FuzzyMatch {
  score: number;
  /** Indexes in the candidate that matched, for highlighting. */
  positions: number[];
}

const BOUNDARY = /[\s/_\-.]/;

export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, positions: [] };
  const smartCase = /[A-ZÄÖÜ]/.test(query);
  const haystack = smartCase ? candidate : candidate.toLowerCase();
  const needle = smartCase ? query : query.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let at = 0;
  let previous = -2;

  for (const character of needle) {
    const found = haystack.indexOf(character, at);
    if (found < 0) return null;
    positions.push(found);
    if (found === previous + 1) score += 8;
    const before = found > 0 ? (haystack[found - 1] as string) : "/";
    if (BOUNDARY.test(before)) score += 6;
    if (found === 0) score += 10;
    score += Math.max(0, 4 - Math.floor(found / 12));
    previous = found;
    at = found + 1;
  }
  // Shorter candidates win ties: `Index.md` before `Index of everything.md`.
  score -= Math.floor(candidate.length / 24);
  return { score, positions };
}

export interface Ranked<T> {
  item: T;
  match: FuzzyMatch;
}

export function rank<T>(query: string, items: T[], key: (item: T) => string, limit = 50): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, key(item));
    if (match) out.push({ item, match });
  }
  out.sort((a, b) => b.match.score - a.match.score);
  return out.slice(0, limit);
}
