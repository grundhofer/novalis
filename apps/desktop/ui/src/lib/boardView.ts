import type { BoardViewDto, CardDto, CardSortDto, ChangedWithinDto, DueWithinDto, PriorityDto } from "../ipc/client";

/**
 * A board's filter and card sort in the boards view (ADR-0054): which cards
 * a column shows, and in which order. Pure, so the view and its tests share
 * one rule.
 */

/** The spans of „Zuletzt geändert“, in the menu's order. */
export const SPANS: readonly ChangedWithinDto[] = ["today", "7d", "30d", "90d"];

/** The orders other than the manual one, in the menu's order. */
export const SORTS: readonly CardSortDto[] = ["title", "updated", "created", "due", "priority"];

/** The steps of the due filter, in the menu's order. */
export const DUES: readonly DueWithinDto[] = ["overdue", "today", "7d", "none"];

/** The steps of a priority, highest first. */
export const PRIORITIES: readonly PriorityDto[] = ["high", "medium", "low"];

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

/** The local midnight `days` days after `now`'s. */
function dayStart(now: Date, days = 0): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days).getTime();
}

/** Whether a card's due day is as the due filter asks (ADR-0054). */
function dueMatches(due: string | null, within: DueWithinDto, now: Date): boolean {
  const day = due ? dueDay(due) : null;
  if (within === "none") return day === null;
  if (day === null) return false;
  const at = day.getTime();
  if (within === "overdue") return at < dayStart(now);
  if (within === "today") return at === dayStart(now);
  return at >= dayStart(now) && at < dayStart(now, 7);
}

/**
 * Whether a card passes the board's filter: the search in its title or
 * description, a change within the span, the label, the priority, the
 * assignee and the due day asked for. Hidden columns are the column's
 * business, not the card's.
 */
export function cardPasses(card: CardDto, search: string, view: BoardViewDto, now: Date): boolean {
  const query = folded(search.trim());
  if (query && !folded(`${card.title}\n${card.description ?? ""}`).includes(query)) return false;
  if (view.changedWithin) {
    const updated = Date.parse(card.updated);
    if (Number.isNaN(updated) || updated < spanStart(view.changedWithin, now)) return false;
  }
  if (view.withLabel) {
    const label = folded(view.withLabel);
    if (!card.labels.some((l) => folded(l) === label)) return false;
  }
  if (view.withPriority && card.priority !== view.withPriority) return false;
  if (view.withAssignee && card.assignee !== view.withAssignee) return false;
  if (view.dueWithin && !dueMatches(card.due, view.dueWithin, now)) return false;
  return true;
}

/** The manual order (§8.3): by `order`, the id breaking ties. */
export function manualOrder(a: CardDto, b: CardDto): number {
  return a.order === b.order ? a.id.localeCompare(b.id) : a.order < b.order ? -1 : 1;
}

/**
 * The order of a column's cards: manual, or by title A to Z (numbers by
 * value), by last change or by creation newest first, by due day earliest
 * first, by priority highest first; `sortReversed` turns a chosen order
 * round. A card without a due day or a priority stays last either way;
 * ties keep the manual order.
 */
export function cardOrder(view: BoardViewDto): (a: CardDto, b: CardDto) => number {
  const sort = view.sort;
  if (!sort) return manualOrder;
  const turn = view.sortReversed ? -1 : 1;
  /** Due day or priority as a number, `null` when the card has none. */
  const rank = (card: CardDto): number | null => {
    if (sort === "due") return card.due ? (dueDay(card.due)?.getTime() ?? null) : null;
    return card.priority ? PRIORITIES.indexOf(card.priority) : null;
  };
  const by = (a: CardDto, b: CardDto): number => {
    // Numbers in a title by their value: „Aufgabe 2“ before „Aufgabe 10“.
    if (sort === "title") return turn * a.title.localeCompare(b.title, undefined, { numeric: true });
    if (sort === "due" || sort === "priority") {
      const [x, y] = [rank(a), rank(b)];
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return turn * (x - y);
    }
    const key = sort === "updated" ? "updated" : "created";
    return turn * (Date.parse(b[key]) - Date.parse(a[key]));
  };
  return (a, b) => by(a, b) || manualOrder(a, b);
}

/** How many filters are on: the search, hidden columns, a span, and each field filter. */
export function filterCount(search: string, view: BoardViewDto): number {
  return [
    search.trim() !== "",
    view.hiddenColumns.length > 0,
    view.changedWithin !== null,
    view.withLabel !== null,
    view.withPriority !== null,
    view.withAssignee !== null,
    view.dueWithin !== null,
  ].filter(Boolean).length;
}

/** A due day `YYYY-MM-DD` as the local midnight it starts at; `null` when it is no day. */
export function dueDay(due: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!match) return null;
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day.getTime()) ? null : day;
}

/** Whether a card's due day is before today (ADR-0054). */
export function isOverdue(due: string | null, now: Date): boolean {
  const day = due ? dueDay(due) : null;
  return day !== null && day.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

