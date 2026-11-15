import { describe, expect, it } from "vitest";

import type { BoardViewDto, CardDto } from "../ipc/client";
import { cardOrder, cardPasses, filterCount, spanStart } from "./boardView";

const plain: BoardViewDto = {
  collapsed: false,
  hiddenColumns: [],
  changedWithin: null,
  withLabel: null,
  withPriority: null,
  withAssignee: null,
  dueWithin: null,
  sort: null,
  sortReversed: false,
  labelTones: {},
};

const card = (id: string, title: string, order: string, updated: string, created = updated, description: string | null = null) =>
  ({
    id,
    title,
    column: "todo",
    order,
    notes: [],
    updated,
    created,
    description,
    descriptionHtml: null,
    labels: [],
    due: null,
    priority: null,
    assignee: null,
  }) as CardDto;

// ADR-0054: which cards a column shows, and in which order.
describe("the board's filter", () => {
  const now = new Date(2026, 10, 15, 14, 0, 0);

  it("finds the search in the title or the description, without case", () => {
    const spec = card("1", "Write the Spec", "a0", "2026-11-01T00:00:00Z", undefined, "für die Kacheln");
    expect(cardPasses(spec, "", plain, now)).toBe(true);
    expect(cardPasses(spec, "  spec ", plain, now)).toBe(true);
    expect(cardPasses(spec, "KACHELN", plain, now)).toBe(true);
    expect(cardPasses(spec, "zoom", plain, now)).toBe(false);
  });

  it("lets through only cards changed within the span", () => {
    const today = card("1", "a", "a0", new Date(2026, 10, 15, 0, 30).toISOString());
    const yesterday = card("2", "b", "a0", new Date(2026, 10, 14, 23, 30).toISOString());
    const old = card("3", "c", "a0", new Date(2026, 8, 1).toISOString());
    const within = (span: BoardViewDto["changedWithin"]) =>
      [today, yesterday, old].filter((c) => cardPasses(c, "", { ...plain, changedWithin: span }, now)).map((c) => c.id);
    expect(within("today")).toEqual(["1"]);
    expect(within("7d")).toEqual(["1", "2"]);
    expect(within("90d")).toEqual(["1", "2", "3"]);
    expect(spanStart("today", now)).toBe(new Date(2026, 10, 15).getTime());
  });

  it("counts the search, hidden columns and a span as one filter each", () => {
    expect(filterCount("", plain)).toBe(0);
    expect(filterCount(" x ", { ...plain, hiddenColumns: ["a", "b"], changedWithin: "30d" })).toBe(3);
    // The order is no filter.
    expect(filterCount("", { ...plain, sort: "title" })).toBe(0);
  });
});

describe("the board's card order", () => {
  const a = card("A", "Beta", "a2", "2026-11-03T00:00:00Z", "2026-10-01T00:00:00Z");
  const b = card("B", "alpha", "a0", "2026-11-01T00:00:00Z", "2026-10-03T00:00:00Z");
  const c = card("C", "Gamma", "a1", "2026-11-02T00:00:00Z", "2026-10-02T00:00:00Z");
  const ids = (view: BoardViewDto) => [a, b, c].sort(cardOrder(view)).map((x) => x.id);

  it("is the manual order without a sort", () => {
    expect(ids(plain)).toEqual(["B", "C", "A"]);
  });

  it("sorts by title A to Z, by last change and by creation newest first, each turned round on request", () => {
    expect(ids({ ...plain, sort: "title" })).toEqual(["B", "A", "C"]);
    expect(ids({ ...plain, sort: "title", sortReversed: true })).toEqual(["C", "A", "B"]);
    expect(ids({ ...plain, sort: "updated" })).toEqual(["A", "C", "B"]);
    expect(ids({ ...plain, sort: "created" })).toEqual(["B", "C", "A"]);
    expect(ids({ ...plain, sort: "created", sortReversed: true })).toEqual(["A", "C", "B"]);
  });

  it("orders numbers in a title by their value", () => {
    const two = card("2", "Aufgabe 2", "a0", "2026-11-01T00:00:00Z");
    const ten = card("10", "Aufgabe 10", "a1", "2026-11-01T00:00:00Z");
    expect([ten, two].sort(cardOrder({ ...plain, sort: "title" })).map((z) => z.id)).toEqual(["2", "10"]);
  });

  it("keeps the manual order between equals", () => {
    const x = card("X", "Same", "a5", "2026-11-01T00:00:00Z");
    const y = card("Y", "Same", "a1", "2026-11-01T00:00:00Z");
    expect([x, y].sort(cardOrder({ ...plain, sort: "title" })).map((z) => z.id)).toEqual(["Y", "X"]);
  });
});

// ADR-0054 part 3b: filter and sort by the card fields.
describe("the card fields in the filter and the order", () => {
  const now = new Date(2026, 10, 15, 14, 0, 0);
  const day = (offset: number) => {
    const d = new Date(2026, 10, 15 + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const with_ = (id: string, fields: Partial<CardDto>) => ({ ...card(id, id, "a0", "2026-11-01T00:00:00Z"), ...fields }) as CardDto;
  const late = with_("late", { due: day(-1), priority: "low", labels: ["Kunde"], assignee: "Anna" });
  const today = with_("today", { due: day(0), priority: "high" });
  const soon = with_("soon", { due: day(6), labels: ["kunde"] });
  const later = with_("later", { due: day(7), priority: "medium", assignee: "Ben" });
  const none = with_("none", {});
  const all = [late, today, soon, later, none];
  const pass = (view: Partial<BoardViewDto>) => all.filter((c) => cardPasses(c, "", { ...plain, ...view }, now)).map((c) => c.id);

  it("filters by label regardless of case, by priority and by assignee", () => {
    expect(pass({ withLabel: "KUNDE" })).toEqual(["late", "soon"]);
    expect(pass({ withPriority: "high" })).toEqual(["today"]);
    expect(pass({ withAssignee: "Ben" })).toEqual(["later"]);
  });

  it("filters by the due day: overdue, today, the next 7 days, none", () => {
    expect(pass({ dueWithin: "overdue" })).toEqual(["late"]);
    expect(pass({ dueWithin: "today" })).toEqual(["today"]);
    expect(pass({ dueWithin: "7d" })).toEqual(["today", "soon"]);
    expect(pass({ dueWithin: "none" })).toEqual(["none"]);
  });

  it("counts each field filter as one", () => {
    expect(filterCount("", { ...plain, withLabel: "a", withPriority: "low", withAssignee: "x", dueWithin: "none" })).toBe(4);
  });

  it("sorts by due day earliest first and by priority highest first, cards without one last either way", () => {
    const ids = (view: Partial<BoardViewDto>) => [...all].sort(cardOrder({ ...plain, ...view })).map((c) => c.id);
    expect(ids({ sort: "due" })).toEqual(["late", "today", "soon", "later", "none"]);
    expect(ids({ sort: "due", sortReversed: true })).toEqual(["later", "soon", "today", "late", "none"]);
    expect(ids({ sort: "priority" }).slice(0, 3)).toEqual(["today", "later", "late"]);
    expect(ids({ sort: "priority", sortReversed: true }).slice(0, 3)).toEqual(["late", "later", "today"]);
    expect(ids({ sort: "priority" }).slice(3).sort()).toEqual(["none", "soon"]);
  });
});

