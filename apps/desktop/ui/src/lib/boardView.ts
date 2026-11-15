import type { BoardViewDto, CardDto, CardSortDto, ChangedWithinDto } from "../ipc/client";

/**
 * A board's filter and card sort in the boards view (ADR-0054): which cards
 * a column shows, and in which order. Pure, so the view and its tests share
 * one rule.
 */

/** The spans of „Zuletzt geändert“, in the menu's order. */
export const SPANS: readonly ChangedWithinDto[] = ["today", "7d", "30d", "90d"];

/** The orders other than the manual one, in the menu's order. */
export const SORTS: readonly CardSortDto[] = ["title", "updated", "created"];

const DAY = 24 * 60 * 60 * 1000;

/** The first instant a card changed within `span` may have, by `now`. */
export function spanStart(span: ChangedWithinDto, now: Date): number {
  if (span === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = span === "7d" ? 7 : span === "30d" ? 30 : 90;
  return now.getTime() - days * DAY;
}

/** Text compared without case and with one form of every letter. */
function folded(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase();
}

/**
 * Whether a card passes the board's filter: the search in its title or
 * description, and a change within the span. Hidden columns are the
 * column's business, not the card's.
 */
export function cardPasses(card: CardDto, search: string, view: BoardViewDto, now: Date): boolean {
  const query = folded(search.trim());
  if (query && !folded(`${card.title}\n${card.description ?? ""}`).includes(query)) return false;
  if (view.changedWithin) {
    const updated = Date.parse(card.updated);
    if (Number.isNaN(updated) || updated < spanStart(view.changedWithin, now)) return false;
  }
  return true;
}

/** The manual order (§8.3): by `order`, the id breaking ties. */
export function manualOrder(a: CardDto, b: CardDto): number {
  return a.order === b.order ? a.id.localeCompare(b.id) : a.order < b.order ? -1 : 1;
}

/**
 * The order of a column's cards: manual, or by title A to Z (numbers by
 * value), by last change or by creation newest first; `sortReversed` turns
 * a chosen order round. Ties keep the manual order.
 */
export function cardOrder(view: BoardViewDto): (a: CardDto, b: CardDto) => number {
  const sort = view.sort;
  if (!sort) return manualOrder;
  const turn = view.sortReversed ? -1 : 1;
  const by = (a: CardDto, b: CardDto): number => {
    // Numbers in a title by their value: „Aufgabe 2“ before „Aufgabe 10“.
    if (sort === "title") return a.title.localeCompare(b.title, undefined, { numeric: true });
    const key = sort === "updated" ? "updated" : "created";
    return Date.parse(b[key]) - Date.parse(a[key]);
  };
  return (a, b) => turn * by(a, b) || manualOrder(a, b);
}

/** How many filters are on: the search, hidden columns, a span. */
export function filterCount(search: string, view: BoardViewDto): number {
  return (search.trim() ? 1 : 0) + (view.hiddenColumns.length > 0 ? 1 : 0) + (view.changedWithin ? 1 : 0);
}

/** The view with no filter and the manual order, collapsed as it was. */
export function plainView(view: BoardViewDto): BoardViewDto {
  return { collapsed: view.collapsed, hiddenColumns: [], changedWithin: null, sort: null, sortReversed: false };
}
